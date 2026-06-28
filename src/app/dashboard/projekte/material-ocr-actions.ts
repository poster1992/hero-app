"use server";

import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getReceiptsInRange, type Receipt } from "@/lib/hero-api";
import {
  getBelegArticlesMap,
  upsertBelegArticles,
  type BelegArticle,
} from "@/lib/beleg-articles";
import {
  getMaterialMappings,
  setMaterialMapping,
  deleteMaterialMapping,
  type MaterialMapping,
} from "@/lib/material-mappings";

const HERO_HOST = "https://login.hero-software.de";
const MODEL = "claude-haiku-4-5";
const PRICE = { in: 1, out: 5 }; // $ / 1 Mio Tokens (Haiku)
const USD_EUR = 0.92;
const round2 = (n: number) => Math.round(n * 100) / 100;

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
              "Artikel-/Materialpositionen. Antworte AUSSCHLIESSLICH mit JSON: " +
              '{"items":[{"name":string,"quantity":number,"unit":string|null,"unit_price":number,"line_total":number}]}. ' +
              "name = Artikelbezeichnung. quantity = Menge. unit = Einheit (z.B. Stk, m2, kg, l) oder null. " +
              "unit_price = Einzelpreis NETTO je Einheit. line_total = Positionssumme NETTO. " +
              "Nur echte Artikel-/Materialpositionen – KEINE Zwischensummen, Versand-/Frachtkosten, Rabattzeilen, " +
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
    const parsed = JSON.parse(raw) as { items?: unknown[] };
    items = (parsed.items ?? [])
      .map((p) => {
        const o = p as Record<string, unknown>;
        const quantity = Number(o.quantity ?? 0);
        const unitPrice = Number(o.unit_price ?? 0);
        const lineTotal =
          Number.isFinite(Number(o.line_total)) && Number(o.line_total) !== 0
            ? Number(o.line_total)
            : round2(quantity * unitPrice);
        return {
          name: String(o.name ?? "").slice(0, 200),
          quantity: Number.isFinite(quantity) ? quantity : 0,
          unit: o.unit != null && String(o.unit).trim() ? String(o.unit).slice(0, 16) : null,
          unitPrice: Number.isFinite(unitPrice) ? round2(unitPrice) : 0,
          lineTotal: Number.isFinite(lineTotal) ? round2(lineTotal) : 0,
        };
      })
      .filter((it) => it.name.trim().length > 0);
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
    return { items: [], total: 0, belegeCount: 0, ocrCostEur: 0, error: "Kein Zugriff." };
  }

  let receipts: Receipt[];
  try {
    const now = new Date();
    const from = `${now.getUTCFullYear() - 6}-01-01T00:00:00Z`;
    const to = `${now.getUTCFullYear() + 1}-12-31T23:59:59Z`;
    receipts = await getReceiptsInRange(from, to);
  } catch {
    return { items: [], total: 0, belegeCount: 0, ocrCostEur: 0, error: "Belege konnten nicht geladen werden." };
  }

  // Dem Projekt zugeordnete Eingangsrechnungen mit Dokument.
  const belege = receipts.filter(
    (r) =>
      r.type === "output" &&
      !!r.fileUpload?.src &&
      r.receiptPositions.some((p) => p.projectMatch?.id === projectMatchId)
  );

  if (belege.length === 0) {
    return { items: [], total: 0, belegeCount: 0, ocrCostEur: 0 };
  }

  const cached = await getBelegArticlesMap(belege.map((b) => b.id));

  // Welche Belege müssen (neu) ausgelesen werden? (kein Cache oder Dokument geändert)
  const toOcr = belege.filter((b) => {
    const hash = createHash("sha256").update(b.fileUpload!.src!).digest("hex");
    const c = cached.get(b.id);
    return !c || c.docHash !== hash;
  });

  let ocrCostEur = 0;
  if (toOcr.length > 0 && process.env.ANTHROPIC_API_KEY) {
    const client = new Anthropic({ maxRetries: 2, timeout: 120_000 });
    const results = await Promise.all(
      toOcr.map(async (b) => {
        const hash = createHash("sha256").update(b.fileUpload!.src!).digest("hex");
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

  // Artikel über alle Belege je Bezeichnung zusammenfassen.
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const map = new Map<string, ProjectBelegMaterialItem>();
  for (const b of belege) {
    const entry = cached.get(b.id);
    if (!entry) continue;
    for (const it of entry.items) {
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

  return { items, total, belegeCount: belege.length, ocrCostEur: round2(ocrCostEur) };
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
