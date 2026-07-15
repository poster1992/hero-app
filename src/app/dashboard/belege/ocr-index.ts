"use server";

import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { getReceiptsInRange, currentHeroToken, type Receipt } from "@/lib/hero-api";
import { getOcrHeroIds, upsertReceiptOcr } from "@/lib/receipt-ocr";
import { getBelegArticleHeroIds, upsertBelegArticles } from "@/lib/beleg-articles";
import { extractBelegArticles, articleDocHash, ARTICLE_OCR_MODEL } from "@/lib/beleg-article-ocr";

const HERO_HOST = "https://login.hero-software.de";
const MODEL = "claude-haiku-4-5";
const PRICE = { in: 1, out: 5 }; // $ / 1 Mio Tokens (Haiku)
const USD_EUR = 0.92;
const BATCH = 8;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Nur Eingangsrechnungen ab 2026 mit Dokument kommen für die OCR-Indexierung infrage. */
async function getCandidates(): Promise<Receipt[]> {
  const from = `2026-01-01T00:00:00Z`;
  const to = `${new Date().getUTCFullYear() + 1}-12-31T23:59:59Z`;
  const receipts = await getReceiptsInRange(from, to);
  return receipts.filter((r) => r.type === "output" && !!r.fileUpload?.src);
}

async function fetchDocument(src: string): Promise<{ data: string; mediaType: string } | null> {
  const token = await currentHeroToken();
  if (!token) return null;
  const res = await fetch(HERO_HOST + src, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) return null;
  const mediaType = res.headers.get("content-type")?.split(";")[0]?.trim() || "application/pdf";
  return { data: Buffer.from(await res.arrayBuffer()).toString("base64"), mediaType };
}

interface OcrExtract {
  full_text: string | null;
  zahlungsziel: string | null;
  skonto_percent: number | null;
  skonto_betrag: number | null;
  total_gross: number | null;
}

/** OCR eines Belegs: Volltext + Zahlungsziel/Skonto. Gibt geschätzte Kosten zurück. */
async function ocrReceipt(client: Anthropic, receipt: Receipt): Promise<number> {
  const src = receipt.fileUpload!.src!;
  const docHash = createHash("sha256").update(src).digest("hex");
  let cost = 0;
  try {
    const doc = await fetchDocument(src);
    if (!doc) {
      await upsertReceiptOcr({ heroId: receipt.id, fullText: null, zahlungsziel: null, skontoPercent: null, skontoBetrag: null, ersparnis: null, docHash, model: MODEL, costEur: 0 });
      return 0;
    }
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
                "Dies ist eine Eingangsrechnung. Antworte AUSSCHLIESSLICH mit JSON: " +
                '{"full_text":string,"zahlungsziel":string|null,"skonto_percent":number|null,"skonto_betrag":number|null,"total_gross":number|null}. ' +
                "full_text = vollständiger lesbarer Text des Belegs (für Suche). " +
                "zahlungsziel = Zahlungsziel/Fälligkeit (Datum TT.MM.JJJJ oder Text wie \"30 Tage netto\"), sonst null. " +
                "skonto_percent/skonto_betrag nur wenn Skonto auf dem Beleg genannt ist; skonto_betrag = zu zahlender Betrag bei Skonto. " +
                "total_gross = Rechnungs-Bruttobetrag. Zahlen mit Punkt als Dezimaltrennzeichen. Keine Erklärung, nur JSON.",
            },
          ],
        },
      ],
    });
    cost = round2(((res.usage?.input_tokens ?? 0) / 1e6 * PRICE.in + (res.usage?.output_tokens ?? 0) / 1e6 * PRICE.out) * USD_EUR * 10000) / 10000;
    const tb = res.content.find((b) => b.type === "text");
    const raw = tb && tb.type === "text" ? tb.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim() : "{}";
    let ex: OcrExtract;
    try {
      ex = JSON.parse(raw) as OcrExtract;
    } catch {
      ex = { full_text: null, zahlungsziel: null, skonto_percent: null, skonto_betrag: null, total_gross: null };
    }

    const gross = typeof ex.total_gross === "number" && ex.total_gross > 0 ? ex.total_gross : receipt.value;
    const pct = typeof ex.skonto_percent === "number" && ex.skonto_percent > 0 ? ex.skonto_percent : null;
    let skontoBetrag = typeof ex.skonto_betrag === "number" && ex.skonto_betrag > 0 ? round2(ex.skonto_betrag) : null;
    if (skontoBetrag == null && pct != null && gross > 0) skontoBetrag = round2(gross * (1 - pct / 100));
    const ersparnis = skontoBetrag != null && gross > 0 ? round2(gross - skontoBetrag) : null;

    await upsertReceiptOcr({
      heroId: receipt.id,
      fullText: ex.full_text ? ex.full_text.slice(0, 60000) : null,
      zahlungsziel: ex.zahlungsziel ? String(ex.zahlungsziel).slice(0, 128) : null,
      skontoPercent: pct,
      skontoBetrag,
      ersparnis,
      docHash,
      model: MODEL,
      costEur: cost,
    });
  } catch {
    // Bei Fehler trotzdem einen Eintrag setzen, damit nicht endlos neu versucht wird.
    try {
      await upsertReceiptOcr({ heroId: receipt.id, fullText: null, zahlungsziel: null, skontoPercent: null, skontoBetrag: null, ersparnis: null, docHash, model: MODEL, costEur: cost });
    } catch {
      /* ignore */
    }
  }
  return cost;
}

/** Artikel + Einzelpreise eines Belegs auslesen und in beleg_articles ablegen. */
async function articleOcr(client: Anthropic, receipt: Receipt): Promise<number> {
  const src = receipt.fileUpload?.src;
  if (!src) return 0;
  try {
    const { items, cost } = await extractBelegArticles(client, receipt);
    const total = round2(items.reduce((s, it) => s + it.lineTotal, 0));
    await upsertBelegArticles({
      heroReceiptId: receipt.id,
      docHash: articleDocHash(src),
      items,
      total,
      model: ARTICLE_OCR_MODEL,
      costEur: cost,
    });
    return cost;
  } catch {
    return 0;
  }
}

export interface OcrStatus {
  total: number;
  done: number;
}

/**
 * Wie viele Eingangsrechnungen ab 2026 sind vollständig indexiert (Volltext UND
 * Artikel/Einzelpreise)?
 */
export async function getOcrStatus(): Promise<OcrStatus> {
  if (!(await getSession())) return { total: 0, done: 0 };
  try {
    const [candidates, ocrDone, artDone] = await Promise.all([
      getCandidates(),
      getOcrHeroIds(),
      getBelegArticleHeroIds(),
    ]);
    const total = candidates.length;
    const done = candidates.filter((r) => ocrDone.has(r.id) && artDone.has(r.id)).length;
    return { total, done };
  } catch {
    return { total: 0, done: 0 };
  }
}

export interface OcrBackfillResult {
  processed: number;
  remaining: number;
  total: number;
  costEur: number;
  error?: string;
}

/** Verarbeitet einen Block noch nicht indexierter Belege (für wiederholten Aufruf). */
export async function runOcrBackfill(): Promise<OcrBackfillResult> {
  if (!(await getSession())) return { processed: 0, remaining: 0, total: 0, costEur: 0, error: "Kein Zugriff." };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { processed: 0, remaining: 0, total: 0, costEur: 0, error: "OCR ist nicht konfiguriert: ANTHROPIC_API_KEY fehlt." };
  }
  let candidates: Receipt[];
  let ocrDone: Set<string>;
  let artDone: Set<string>;
  try {
    [candidates, ocrDone, artDone] = await Promise.all([
      getCandidates(),
      getOcrHeroIds(),
      getBelegArticleHeroIds(),
    ]);
  } catch (e) {
    return { processed: 0, remaining: 0, total: 0, costEur: 0, error: e instanceof Error ? e.message : "Laden fehlgeschlagen." };
  }
  const total = candidates.length;
  // Fehlt entweder der Volltext ODER die Artikelpositionen.
  const missing = candidates.filter((r) => !ocrDone.has(r.id) || !artDone.has(r.id));
  const batch = missing.slice(0, BATCH);
  const client = new Anthropic({ maxRetries: 2, timeout: 120_000 });
  const costs = await Promise.all(
    batch.map(async (r) => {
      let c = 0;
      if (!ocrDone.has(r.id)) c += await ocrReceipt(client, r); // Volltext + Skonto
      if (!artDone.has(r.id)) c += await articleOcr(client, r); // Artikel + Einzelpreise
      return c;
    })
  );
  const costEur = round2(costs.reduce((s, c) => s + c, 0) * 10000) / 10000;
  return { processed: batch.length, remaining: missing.length - batch.length, total, costEur };
}
