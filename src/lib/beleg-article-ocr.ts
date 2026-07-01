import "server-only";
import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { Receipt } from "./hero-api";
import type { BelegArticle } from "./beleg-articles";

const HERO_HOST = "https://login.hero-software.de";
export const ARTICLE_OCR_MODEL = "claude-haiku-4-5";
const PRICE = { in: 1, out: 5 }; // $ / 1 Mio Tokens (Haiku)
const USD_EUR = 0.92;
// Version der Extraktionslogik – Änderung invalidiert den Beleg-Cache.
export const ARTICLE_OCR_VERSION = "v2-rabatt";
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Cache-Hash eines Belegdokuments für beleg_articles (inkl. Logik-Version). */
export const articleDocHash = (src: string) =>
  createHash("sha256").update(`${src}|${ARTICLE_OCR_VERSION}`).digest("hex");

/** Lädt ein HERO-Belegdokument (PDF/Bild) als base64 (auth). */
export async function fetchHeroDocument(src: string): Promise<{ data: string; mediaType: string } | null> {
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

/**
 * Liest die Artikel-/Materialpositionen (Name, Menge, Einheit, Einzelpreis netto)
 * einer Eingangsrechnung per OCR aus. Berücksichtigt Positions- und Gesamtrabatte.
 * Gibt Items + geschätzte Kosten zurück.
 */
export async function extractBelegArticles(
  client: Anthropic,
  receipt: Receipt
): Promise<{ items: BelegArticle[]; cost: number }> {
  const src = receipt.fileUpload?.src;
  if (!src) return { items: [], cost: 0 };
  const doc = await fetchHeroDocument(src);
  if (!doc) return { items: [], cost: 0 };
  const isImage = doc.mediaType.startsWith("image/");
  const block = isImage
    ? { type: "image" as const, source: { type: "base64" as const, media_type: doc.mediaType as "image/png", data: doc.data } }
    : { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: doc.data } };

  const res = await client.messages.create({
    model: ARTICLE_OCR_MODEL,
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
              "global_discount = ein auf die GESAMTSUMME/alle Positionen wirkender Rabatt/Nachlass (z.B. 'Rabatt 3%' " +
              "oder 'Nachlass 50,00 €'); gib percent ODER amount an, sonst beide null. " +
              "WICHTIG: Skonto ist KEIN Rabatt (Skonto = Zahlungsrabatt) und darf NICHT abgezogen werden. " +
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
