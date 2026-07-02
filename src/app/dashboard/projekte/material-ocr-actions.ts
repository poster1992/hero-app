"use server";

import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getReceiptsInRange, type Receipt } from "@/lib/hero-api";
import {
  getBelegArticlesMap,
  upsertBelegArticles,
  deleteBelegArticles,
  type BelegArticle,
} from "@/lib/beleg-articles";
import {
  getMaterialMappings,
  setMaterialMapping,
  deleteMaterialMapping,
  deleteAllMaterialMappings,
  getMaterialExcludes,
  addMaterialExclude,
  removeMaterialExclude,
  deleteAllMaterialExcludes,
  materialKey,
  type MaterialMapping,
} from "@/lib/material-mappings";

const HERO_HOST = "https://login.hero-software.de";
const MODEL = "claude-haiku-4-5";
const PRICE = { in: 1, out: 5 }; // $ / 1 Mio Tokens (Haiku)
const USD_EUR = 0.92;
// Version der OCR-Extraktionslogik – Änderung invalidiert den Beleg-Cache.
// WICHTIG: Prompt + Version mit src/lib/beleg-article-ocr.ts synchron halten.
const OCR_VERSION = "v4-einheit";
const round2 = (n: number) => Math.round(n * 100) / 100;
const docHashOf = (src: string) => createHash("sha256").update(`${src}|${OCR_VERSION}`).digest("hex");

/** Aggregierte Ist-Position aus Belegen (je Artikel). */
export interface ProjectBelegMaterialItem {
  name: string;
  unit: string | null;
  quantity: number;
  value: number;
}

export interface ProjectBelegMaterials {
  items: ProjectBelegMaterialItem[];
  total: number;
  belegeCount: number;
  ocrCostEur: number;
  /** Aus dem Ist entfernte Beleg-Artikel (zum Wiederherstellen). */
  excluded: string[];
  error?: string;
}

async function fetchDocument(src: string): Promise<{ data: string; mediaType: string } | null> {
  const token = process.env.HERO_API_TOKEN;
  if (!token) return null;
  const res = await fetch(HERO_HOST + src, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const mediaType = res.headers.get("content-type")?.split(";")[0]?.trim() || "application/pdf";
  return { data: Buffer.from(await res.arrayBuffer()).toString("base64"), mediaType };
}

/** OCR eines Belegs: extrahiert die Artikelpositionen. Gibt Items + Kosten zurück. */
async function ocrBelegArticles(
  client: Anthropic,
  receipt: Receipt
): Promise<{ items: BelegArticle[]; cost: number }> {
  const src = receipt.fileUpload!.src!;
  const doc = await fetchDocument(src);
  if (!doc) return { items: [], cost: 0 };
  const isImage = doc.mediaType.startsWith("image/");
  const block = isImage
    ? { type: "image" as const, source: { type: "base64" as const, media_type: doc.mediaType as "image/png", data: doc.data } }
    : { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: doc.data } };

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [
      {
        role: "user",
        content: [
          block,
          {
            type: "text",
            text:
              "Dies ist eine Eingangsrechnung (Lieferantenrechnung). Extrahiere die einzelnen " +
              "Artikel-/Materialpositionen UND berücksichtige RABATTE. Antworte AUSSCHLIESSLICH mit JSON: " +
              '{"items":[{"name":string,"quantity":number,"unit":string|null,"unit_price":number,"line_total":number}],' +
              '"global_discount":{"percent":number|null,"amount":number|null}}. ' +
              "name = Artikelbezeichnung. quantity = Menge. unit = Einheit (z.B. Stk, m2, kg, l) oder null. " +
              "line_total = Positionssumme NETTO NACH Abzug eines positionsbezogenen Rabatts/Nachlasses (falls die " +
              "Position selbst einen Rabatt in % oder € hat, ziehe ihn ab). unit_price = line_total / quantity " +
              "(effektiver Einkaufspreis je Einheit NACH Rabatt). " +
              "SEHR WICHTIG – Positionsrabatt DIREKT UNTER der Position: Manche Lieferanten (z.B. Fliesen-Zentrum) " +
              "schreiben unter eine Position eine eigene Rabattzeile wie 'Kund.Rabatt aut %. -35,000 % aus 1.269,74 " +
              "-444,41' oder 'Kundenrabatt: -45,000 % aus 73,37 = -33,02 EUR'. Dieser Rabatt gehört zur DARÜBER " +
              "stehenden Position: line_total (netto) = Positionsbetrag − Rabattabzug (Beispiel: 1.269,74 − 444,41 = " +
              "825,33). Verwende IMMER den Netto-Betrag NACH Rabatt, niemals den Bruttobetrag davor. Gib die " +
              "Rabattzeile NICHT als eigene Position aus. Wenn eine 'Nettosumme' für die Position angegeben ist, nimm diese. " +
              "EINHEIT/MENGE – SEHR WICHTIG für konsistente Preise (derselbe Artikel MUSS über alle Rechnungen dieselbe " +
              "Einheit haben): (1) Wird ein Artikel klar nach FLÄCHE/LÄNGE/VOLUMEN verkauft (Stückpreis wie '62,98 / 1 M2', " +
              "'.. / lfm', '.. / l'), nutze diese Einheit (m2, lfm, l): quantity = Menge in dieser Einheit, unit_price = " +
              "line_total / quantity. (2) Wird ein Artikel in GEBINDEN verkauft (Sack, Beutel, Karton, Eimer, Rolle, " +
              "Stück/ST – oft mit Füllgewicht im Namen, z.B. 'SERVOFLEX K PLUS 20 KG SACK', 'X 5 KG BEUTEL'), nutze IMMER " +
              "die GEBINDE-/VERKAUFSEINHEIT: unit = Sack/Beutel/Karton/Rolle/Stück, quantity = ANZAHL der Gebinde (Spalte " +
              "'Menge'/'Anzahl', z.B. 54), unit_price = line_total / Anzahl. Verwende NIEMALS das Füllgewicht in kg (z.B. " +
              "eine Gewichtsspalte '1.080,000' oder einen kg-Grundpreis) als unit oder quantity – das '20 KG' im Namen ist " +
              "nur die Packungsgröße, NICHT die Menge. So ist z.B. 'Kiesel/Servoflex' immer je Sack, nicht mal kg mal Sack. " +
              "global_discount = ein auf die GESAMTSUMME/alle Positionen wirkender Rabatt/Nachlass (z.B. 'Rabatt 3%' " +
              "oder 'Nachlass 50,00 €'); gib percent ODER amount an, sonst beide null. " +
              "WICHTIG: Skonto ist KEIN Rabatt (Skonto = Zahlungsrabatt) und darf NICHT abgezogen werden. " +
              "'Maut Zuschlag'/Frachtzuschlag ist KEIN Artikel und wird NICHT eingerechnet. " +
              "Nur echte Artikel-/Materialpositionen – KEINE Zwischensummen, Versand-/Frachtkosten, reine Rabattzeilen, " +
              "MwSt- oder Gesamtsummen. Wenn keine Positionen erkennbar sind: leeres Array. " +
              "Zahlen mit Punkt als Dezimaltrennzeichen, keine Tausenderpunkte. Keine Erklärung, nur JSON.",
          },
        ],
      },
    ],
  });

  const cost =
    Math.round(
      (((res.usage?.input_tokens ?? 0) / 1e6) * PRICE.in +
        ((res.usage?.output_tokens ?? 0) / 1e6) * PRICE.out) *
        USD_EUR *
        10000
    ) / 10000;

  const tb = res.content.find((b) => b.type === "text");
  const raw =
    tb && tb.type === "text"
      ? tb.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
      : "{}";
  let items: BelegArticle[] = [];
  try {
    const parsed = JSON.parse(raw) as {
      items?: unknown[];
      global_discount?: { percent?: number | null; amount?: number | null } | null;
    };
    items = (parsed.items ?? [])
      .map((p) => {
        const o = p as Record<string, unknown>;
        const quantity = Number(o.quantity ?? 0);
        let lineTotal = Number(o.line_total);
        let unitPrice = Number(o.unit_price);
        // line_total ist netto NACH Positionsrabatt; fehlt es, aus unit_price × Menge.
        if (!Number.isFinite(lineTotal) || lineTotal === 0) {
          lineTotal = round2((Number.isFinite(unitPrice) ? unitPrice : 0) * (Number.isFinite(quantity) ? quantity : 0));
        }
        if (!Number.isFinite(unitPrice) || unitPrice === 0) {
          unitPrice = quantity ? round2(lineTotal / quantity) : 0;
        }
        return {
          name: String(o.name ?? "").slice(0, 200),
          quantity: Number.isFinite(quantity) ? quantity : 0,
          unit: o.unit != null && String(o.unit).trim() ? String(o.unit).slice(0, 16) : null,
          unitPrice: Number.isFinite(unitPrice) ? round2(unitPrice) : 0,
          lineTotal: Number.isFinite(lineTotal) ? round2(lineTotal) : 0,
        };
      })
      .filter((it) => it.name.trim().length > 0);

    // Gesamtrabatt (auf alle Positionen) proportional abziehen.
    const gd = parsed.global_discount;
    const sum = items.reduce((s, it) => s + it.lineTotal, 0);
    let factor = 1;
    if (gd) {
      if (typeof gd.percent === "number" && gd.percent > 0 && gd.percent < 100) {
        factor = 1 - gd.percent / 100;
      } else if (typeof gd.amount === "number" && gd.amount > 0 && sum > gd.amount) {
        factor = (sum - gd.amount) / sum;
      }
    }
    if (factor !== 1) {
      items = items.map((it) => ({
        ...it,
        lineTotal: round2(it.lineTotal * factor),
        unitPrice: round2(it.unitPrice * factor),
      }));
    }
  } catch {
    items = [];
  }
  return { items, cost };
}

/**
 * Liest die Artikel aller dem Projekt zugeordneten Belege (Eingangsrechnungen) per
 * OCR aus und fasst sie je Artikel zusammen (Ist-Material aus Belegen). Ergebnisse
 * werden je Beleg gecacht – beim erneuten Öffnen entstehen keine neuen Kosten.
 */
export async function getProjectBelegArticles(projectMatchId: number): Promise<ProjectBelegMaterials> {
  if (!(await getSession())) {
    return { items: [], total: 0, belegeCount: 0, ocrCostEur: 0, excluded: [], error: "Kein Zugriff." };
  }

  let receipts: Receipt[];
  try {
    const now = new Date();
    const from = `${now.getUTCFullYear() - 6}-01-01T00:00:00Z`;
    const to = `${now.getUTCFullYear() + 1}-12-31T23:59:59Z`;
    receipts = await getReceiptsInRange(from, to);
  } catch {
    return { items: [], total: 0, belegeCount: 0, ocrCostEur: 0, excluded: [], error: "Belege konnten nicht geladen werden." };
  }

  // Dem Projekt zugeordnete Eingangsrechnungen mit Dokument.
  const belege = receipts.filter(
    (r) =>
      r.type === "output" &&
      !!r.fileUpload?.src &&
      r.receiptPositions.some((p) => p.projectMatch?.id === projectMatchId)
  );

  if (belege.length === 0) {
    return { items: [], total: 0, belegeCount: 0, ocrCostEur: 0, excluded: [] };
  }

  const excludeSet = await getMaterialExcludes(projectMatchId).catch(() => new Set<string>());

  const cached = await getBelegArticlesMap(belege.map((b) => b.id));

  // Welche Belege müssen (neu) ausgelesen werden? (kein Cache oder Dokument geändert)
  const toOcr = belege.filter((b) => {
    const hash = docHashOf(b.fileUpload!.src!);
    const c = cached.get(b.id);
    return !c || c.docHash !== hash;
  });

  let ocrCostEur = 0;
  if (toOcr.length > 0 && process.env.ANTHROPIC_API_KEY) {
    const client = new Anthropic({ maxRetries: 2, timeout: 120_000 });
    const results = await Promise.all(
      toOcr.map(async (b) => {
        const hash = docHashOf(b.fileUpload!.src!);
        try {
          const { items, cost } = await ocrBelegArticles(client, b);
          const total = round2(items.reduce((s, it) => s + it.lineTotal, 0));
          await upsertBelegArticles({
            heroReceiptId: b.id,
            docHash: hash,
            items,
            total,
            model: MODEL,
            costEur: cost,
          });
          return { id: b.id, items, total, cost };
        } catch {
          return { id: b.id, items: [] as BelegArticle[], total: 0, cost: 0 };
        }
      })
    );
    for (const r of results) {
      ocrCostEur += r.cost;
      cached.set(r.id, { heroReceiptId: r.id, docHash: null, items: r.items, total: r.total });
    }
  }

  // Artikel über alle Belege je Bezeichnung zusammenfassen (entfernte ausblenden).
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const map = new Map<string, ProjectBelegMaterialItem>();
  const excludedNames = new Map<string, string>(); // ist_key → Anzeigename
  for (const b of belege) {
    const entry = cached.get(b.id);
    if (!entry) continue;
    for (const it of entry.items) {
      if (excludeSet.has(materialKey(it.name))) {
        excludedNames.set(materialKey(it.name), it.name);
        continue;
      }
      const key = norm(it.name);
      const cur = map.get(key) ?? { name: it.name, unit: it.unit, quantity: 0, value: 0 };
      cur.quantity += it.quantity;
      cur.value += it.lineTotal;
      if (!cur.unit) cur.unit = it.unit;
      map.set(key, cur);
    }
  }

  const items = [...map.values()]
    .map((i) => ({ ...i, quantity: round2(i.quantity), value: round2(i.value) }))
    .filter((i) => Math.abs(i.quantity) > 0.0001 || Math.abs(i.value) > 0.0001)
    .sort((a, b) => b.value - a.value);
  const total = round2(items.reduce((s, i) => s + i.value, 0));

  return {
    items,
    total,
    belegeCount: belege.length,
    ocrCostEur: round2(ocrCostEur),
    excluded: [...excludedNames.values()],
  };
}

/** Manuelle Soll/Ist-Zuordnungen eines Projekts laden. */
export async function getProjectMaterialMappings(projectMatchId: number): Promise<MaterialMapping[]> {
  if (!(await getSession())) return [];
  try {
    return await getMaterialMappings(projectMatchId);
  } catch {
    return [];
  }
}

/** Speichert eine manuelle Zuordnung (Drag & Drop: Ist-Artikel → Soll-Artikel). */
export async function saveProjectMaterialMapping(
  projectMatchId: number,
  istName: string,
  sollName: string
): Promise<{ ok: boolean }> {
  const session = await getSession();
  if (!session) return { ok: false };
  let userId: number | null = null;
  try {
    userId = (await getUserByUsername(session.username))?.id ?? null;
  } catch {
    /* ignore */
  }
  try {
    await setMaterialMapping({ projectMatchId, istName, sollName, userId });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Entfernt eine manuelle Zuordnung wieder. */
export async function removeProjectMaterialMapping(
  projectMatchId: number,
  istName: string
): Promise<{ ok: boolean }> {
  if (!(await getSession())) return { ok: false };
  try {
    await deleteMaterialMapping(projectMatchId, istName);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Blendet einen über Belege zugeordneten Artikel aus dem Ist aus. */
export async function excludeProjectBelegArticle(
  projectMatchId: number,
  istName: string
): Promise<{ ok: boolean }> {
  const session = await getSession();
  if (!session) return { ok: false };
  let userId: number | null = null;
  try {
    userId = (await getUserByUsername(session.username))?.id ?? null;
  } catch {
    /* ignore */
  }
  try {
    await addMaterialExclude(projectMatchId, istName, userId);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Macht das Ausblenden eines Beleg-Artikels rückgängig. */
export async function restoreProjectBelegArticle(
  projectMatchId: number,
  istName: string
): Promise<{ ok: boolean }> {
  if (!(await getSession())) return { ok: false };
  try {
    await removeMaterialExclude(projectMatchId, istName);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Setzt die komplette Material-Zuordnung eines Projekts zurück: löscht manuelle
 * Zuordnungen, Ausblendungen und den OCR-Cache der Belege → beim nächsten Laden
 * werden die Belege frisch ausgelesen und neu zugeordnet.
 */
export async function resetProjectMaterialAssignment(
  projectMatchId: number
): Promise<{ ok: boolean }> {
  if (!(await getSession())) return { ok: false };
  try {
    await Promise.all([
      deleteAllMaterialMappings(projectMatchId),
      deleteAllMaterialExcludes(projectMatchId),
    ]);
    // OCR-Cache der zugeordneten Belege leeren, damit sie neu ausgelesen werden.
    try {
      const now = new Date();
      const from = `${now.getUTCFullYear() - 6}-01-01T00:00:00Z`;
      const to = `${now.getUTCFullYear() + 1}-12-31T23:59:59Z`;
      const receipts = await getReceiptsInRange(from, to);
      const belegeIds = receipts
        .filter(
          (r) =>
            r.type === "output" &&
            !!r.fileUpload?.src &&
            r.receiptPositions.some((p) => p.projectMatch?.id === projectMatchId)
        )
        .map((r) => r.id);
      await deleteBelegArticles(belegeIds);
    } catch {
      /* Cache-Leeren optional */
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
