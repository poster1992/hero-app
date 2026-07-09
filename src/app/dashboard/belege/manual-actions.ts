"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import {
  createManualReceipt,
  setManualReceiptPaid,
  updateManualReceipt,
} from "@/lib/manual-receipts";
import {
  addChecklistItem,
  removeChecklistItem,
  setChecklistDone,
} from "@/lib/belege-checklist";

const PATH = "/dashboard/belege";

export interface UploadBelegState {
  error?: string;
  success?: string;
}

export async function uploadBelegAction(
  _prev: UploadBelegState,
  formData: FormData
): Promise<UploadBelegState> {
  const session = await getSession();
  if (!session) return { error: "Nicht angemeldet." };
  const me = await getUserByUsername(session.username);

  const date = String(formData.get("date") ?? "").trim() || null;
  const supplier = String(formData.get("supplier") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const grossRaw = String(formData.get("gross") ?? "").trim().replace(",", ".");
  const gross = Number(grossRaw);
  const vatRateRaw = String(formData.get("vatRate") ?? "").trim().replace(",", ".");
  const vatRate = vatRateRaw ? Number(vatRateRaw) : null;
  const account = String(formData.get("account") ?? "").trim(); // "number|name"

  if (!Number.isFinite(gross) || gross <= 0) {
    return { error: "Bitte einen gültigen Betrag (brutto) angeben." };
  }
  if (vatRate != null && !Number.isFinite(vatRate)) {
    return { error: "MwSt-Satz muss eine Zahl sein." };
  }
  if (!account) return { error: "Bitte ein Konto auswählen." };

  const sep = account.indexOf("|");
  const accountNumber = sep >= 0 ? account.slice(0, sep) : account;
  const accountName = sep >= 0 ? account.slice(sep + 1) : "";

  const upload = formData.get("file");
  let file: { buffer: Buffer; originalName: string; mime: string } | null = null;
  if (upload && typeof upload === "object" && "arrayBuffer" in upload && upload.size > 0) {
    const f = upload as File;
    if (f.size > 15 * 1024 * 1024) return { error: "Datei zu groß (max. 15 MB)." };
    file = {
      buffer: Buffer.from(await f.arrayBuffer()),
      originalName: f.name,
      mime: f.type || "application/octet-stream",
    };
  }

  try {
    await createManualReceipt({
      date,
      supplier,
      description,
      gross,
      vatRate,
      accountNumber,
      accountName,
      file,
      uploadedBy: me?.id ?? null,
    });
  } catch {
    return { error: "Beleg konnte nicht gespeichert werden." };
  }

  revalidatePath(PATH);
  return { success: "Beleg gespeichert." };
}

export async function updateBelegAction(
  _prev: UploadBelegState,
  formData: FormData
): Promise<UploadBelegState> {
  const session = await getSession();
  if (!session) return { error: "Nicht angemeldet." };

  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) return { error: "Ungültiger Beleg." };

  const date = String(formData.get("date") ?? "").trim() || null;
  const supplier = String(formData.get("supplier") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const grossRaw = String(formData.get("gross") ?? "").trim().replace(",", ".");
  const gross = Number(grossRaw);
  const vatRateRaw = String(formData.get("vatRate") ?? "").trim().replace(",", ".");
  const vatRate = vatRateRaw ? Number(vatRateRaw) : null;
  const account = String(formData.get("account") ?? "").trim(); // "number|name"

  if (!Number.isFinite(gross) || gross <= 0) {
    return { error: "Bitte einen gültigen Betrag (brutto) angeben." };
  }
  if (vatRate != null && !Number.isFinite(vatRate)) {
    return { error: "MwSt-Satz muss eine Zahl sein." };
  }
  if (!account) return { error: "Bitte ein Konto auswählen." };

  const sep = account.indexOf("|");
  const accountNumber = sep >= 0 ? account.slice(0, sep) : account;
  const accountName = sep >= 0 ? account.slice(sep + 1) : "";

  const upload = formData.get("file");
  let file: { buffer: Buffer; originalName: string; mime: string } | null = null;
  if (upload && typeof upload === "object" && "arrayBuffer" in upload && upload.size > 0) {
    const f = upload as File;
    if (f.size > 15 * 1024 * 1024) return { error: "Datei zu groß (max. 15 MB)." };
    file = {
      buffer: Buffer.from(await f.arrayBuffer()),
      originalName: f.name,
      mime: f.type || "application/octet-stream",
    };
  }

  try {
    await updateManualReceipt({
      id,
      date,
      supplier,
      description,
      gross,
      vatRate,
      accountNumber,
      accountName,
      file,
    });
  } catch {
    return { error: "Beleg konnte nicht aktualisiert werden." };
  }

  revalidatePath(PATH);
  return { success: "Beleg aktualisiert." };
}

export interface LohnSumResult {
  ok: boolean;
  /** Summe aller „Total Brutto"-Werte. */
  total?: number;
  /** Anzahl erkannter Werte (Seiten/Mitarbeiter). */
  count?: number;
  /** Einzelwerte (für die Kontrolle). */
  values?: number[];
  error?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Robustes Parsen deutscher/englischer Zahlen ("1.234,56", "1234.56", 1234.56). */
function toNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v ?? "").trim();
  if (!s) return 0;
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Liest per OCR aus einer (mehrseitigen) Lohnabrechnung alle „Total Brutto"-
 * Beträge (je Seite/Mitarbeiter) und liefert deren Summe.
 */
export async function computeLohnBruttoAction(formData: FormData): Promise<LohnSumResult> {
  if (!(await getSession())) return { ok: false, error: "Nicht angemeldet." };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "OCR ist nicht konfiguriert (ANTHROPIC_API_KEY fehlt)." };
  }
  const upload = formData.get("file");
  if (!upload || typeof upload !== "object" || !("arrayBuffer" in upload) || (upload as File).size === 0) {
    return { ok: false, error: "Bitte zuerst die Lohn-Datei auswählen." };
  }
  const f = upload as File;
  if (f.size > 25 * 1024 * 1024) return { ok: false, error: "Datei zu groß (max. 25 MB)." };

  const mime = f.type || "application/pdf";
  const isImage = mime.startsWith("image/");
  const dataB64 = Buffer.from(await f.arrayBuffer()).toString("base64");
  const block = isImage
    ? { type: "image" as const, source: { type: "base64" as const, media_type: mime as "image/png", data: dataB64 } }
    : { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: dataB64 } };

  const prompt =
    "Dies ist eine mehrseitige Lohnabrechnung bzw. ein Lohnjournal. Auf jeder Seite (bzw. je " +
    "Mitarbeiter) steht ein Betrag mit der Bezeichnung „Total Brutto\" (Bruttolohn). Extrahiere ALLE " +
    "diese „Total Brutto\"-Beträge – genau einen pro Seite/Mitarbeiter. Antworte AUSSCHLIESSLICH mit " +
    'JSON: {"werte": number[]}. Nutze Punkt als Dezimaltrennzeichen und KEINE Tausenderpunkte. Gib ' +
    "ausschließlich die „Total Brutto\"-Werte aus – KEINE Netto-, Abzugs-, Zwischen- oder Gesamtsummen. " +
    "Keine Erklärung, nur JSON.";

  try {
    const client = new Anthropic({ maxRetries: 2, timeout: 120_000 });
    const res = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4000,
      messages: [{ role: "user", content: [block, { type: "text", text: prompt }] }],
    });
    const tb = res.content.find((b) => b.type === "text");
    const raw =
      tb && tb.type === "text"
        ? tb.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
        : "{}";
    const parsed = JSON.parse(raw) as { werte?: unknown[] };
    const values = (parsed.werte ?? []).map(toNum).filter((n) => n > 0);
    if (values.length === 0) {
      return { ok: false, error: "Es wurden keine „Total Brutto\"-Werte erkannt. Bitte Betrag manuell eintragen." };
    }
    const total = round2(values.reduce((s, n) => s + n, 0));
    return { ok: true, total, count: values.length, values: values.map(round2) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "OCR fehlgeschlagen." };
  }
}

/** Markiert einen manuellen Beleg als bezahlt/offen. */
export async function setBelegPaidAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const id = Number(formData.get("id"));
  const paid = String(formData.get("paid")) === "1";
  if (!Number.isFinite(id) || id <= 0) return;
  await setManualReceiptPaid(id, paid);
  revalidatePath(PATH);
}

/** Hakt einen Checklisten-Punkt für einen Monat ab bzw. wieder ab. */
export async function toggleChecklistAction(
  itemId: number,
  year: number,
  month: number,
  done: boolean
): Promise<void> {
  const session = await getSession();
  if (!session) return;
  if (!Number.isFinite(itemId) || itemId <= 0) return;
  await setChecklistDone(itemId, year, month, done);
  revalidatePath(PATH);
}

/** Fügt einen wiederkehrenden Checklisten-Punkt hinzu. */
export async function addChecklistItemAction(label: string): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const trimmed = label.trim();
  if (!trimmed) return;
  await addChecklistItem(trimmed);
  revalidatePath(PATH);
}

/** Entfernt einen Checklisten-Punkt (Historie bleibt erhalten). */
export async function removeChecklistItemAction(itemId: number): Promise<void> {
  const session = await getSession();
  if (!session) return;
  if (!Number.isFinite(itemId) || itemId <= 0) return;
  await removeChecklistItem(itemId);
  revalidatePath(PATH);
}
