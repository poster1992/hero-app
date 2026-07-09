"use server";

import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import {
  listManualReceiptIdsNeedingOcr,
  setManualReceiptOcrText,
  getManualReceiptFile,
  getManualOcrStatus,
} from "@/lib/manual-receipts";

const MODEL = "claude-haiku-4-5";
const PRICE = { in: 1, out: 5 }; // $ / 1 Mio Tokens (Haiku)
const USD_EUR = 0.92;
const BATCH = 6;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

export interface ManualOcrStatus {
  total: number;
  done: number;
}

export async function getManualOcrIndexStatus(): Promise<ManualOcrStatus> {
  if (!(await getSession())) return { total: 0, done: 0 };
  try {
    return await getManualOcrStatus();
  } catch {
    return { total: 0, done: 0 };
  }
}

export interface ManualOcrBackfillResult {
  processed: number;
  remaining: number;
  total: number;
  costEur: number;
  error?: string;
}

/** Liest den Volltext eines Belegs per OCR (für die Volltextsuche). */
async function ocrText(client: Anthropic, id: number): Promise<number> {
  const file = await getManualReceiptFile(id);
  if (!file) {
    await setManualReceiptOcrText(id, "");
    return 0;
  }
  const mime = file.mime || "application/pdf";
  const isImage = mime.startsWith("image/");
  const data = file.data.toString("base64");
  const block = isImage
    ? { type: "image" as const, source: { type: "base64" as const, media_type: mime as "image/png", data } }
    : { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data } };
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
              "Transkribiere den gesamten lesbaren Text dieses Belegs/Dokuments möglichst " +
              "vollständig (für eine Volltextsuche). Gib NUR den reinen Text zurück, keine " +
              "Erklärung, kein JSON, keine Formatierung.",
          },
        ],
      },
    ],
  });
  const cost = round4(
    (((res.usage?.input_tokens ?? 0) / 1e6) * PRICE.in +
      ((res.usage?.output_tokens ?? 0) / 1e6) * PRICE.out) *
      USD_EUR
  );
  const tb = res.content.find((b) => b.type === "text");
  const text = tb && tb.type === "text" ? tb.text.trim() : "";
  await setManualReceiptOcrText(id, text || "");
  return cost;
}

/** Verarbeitet einen Block noch nicht volltext-indexierter manueller Belege. */
export async function runManualOcrBackfill(): Promise<ManualOcrBackfillResult> {
  if (!(await getSession())) return { processed: 0, remaining: 0, total: 0, costEur: 0, error: "Kein Zugriff." };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { processed: 0, remaining: 0, total: 0, costEur: 0, error: "OCR ist nicht konfiguriert: ANTHROPIC_API_KEY fehlt." };
  }
  let missing: number[];
  let status: ManualOcrStatus;
  try {
    [missing, status] = await Promise.all([listManualReceiptIdsNeedingOcr(), getManualOcrStatus()]);
  } catch (e) {
    return { processed: 0, remaining: 0, total: 0, costEur: 0, error: e instanceof Error ? e.message : "Laden fehlgeschlagen." };
  }
  const batch = missing.slice(0, BATCH);
  const client = new Anthropic({ maxRetries: 2, timeout: 120_000 });
  let costEur = 0;
  const costs = await Promise.all(
    batch.map(async (id) => {
      try {
        return await ocrText(client, id);
      } catch {
        // Bei Fehler leeren Text setzen, damit nicht endlos neu versucht wird.
        try {
          await setManualReceiptOcrText(id, "");
        } catch {
          /* ignore */
        }
        return 0;
      }
    })
  );
  for (const c of costs) costEur += c;
  return {
    processed: batch.length,
    remaining: Math.max(0, missing.length - batch.length),
    total: status.total,
    costEur: round4(costEur),
  };
}
