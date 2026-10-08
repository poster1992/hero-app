"use server";

import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import {
  appendStatementPdf,
  undoLastStatementUpload,
  addStatementMarker,
  deleteStatementMarker,
  drawStatementHighlights,
  listStatementHighlights,
  deleteStatementHighlight,
  addStatementStamp,
  deleteStatementStamp,
  listStatementLines,
  addStatementLine,
  addStatementLinesBatch,
  deleteStatementLine,
  addReceiptToLine,
  removeReceiptFromLine,
  searchAssignableReceipts,
  type HighlightRect,
  type StatementHighlight,
  type StatementLine,
  type AssignableReceiptOption,
} from "@/lib/kontoauszuege";
import { extractLineAmount } from "@/lib/kontoauszug-line-ocr";

const MAX_SIZE = 25 * 1024 * 1024;

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function currentUserId(): Promise<number | null> {
  const session = await getSession();
  if (!session) return null;
  const user = await getUserByUsername(session.username);
  return user?.id ?? null;
}

/** Hängt eine neue PDF-Datei hinten an die Sammel-Datei an. */
export async function uploadStatementAction(formData: FormData): Promise<ActionResult> {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, error: "Nicht angemeldet." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Keine Datei ausgewählt." };
  if (file.size > MAX_SIZE) return { ok: false, error: "Datei zu groß (max. 25 MB)." };
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await appendStatementPdf({ buffer, originalName: file.name, userId });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Anhängen fehlgeschlagen." };
  }
}

/** Entfernt den zuletzt angehängten Auszug wieder (falsche Datei erwischt). */
export async function undoLastStatementUploadAction(): Promise<ActionResult> {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, error: "Nicht angemeldet." };
  try {
    await undoLastStatementUpload();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Rückgängig machen fehlgeschlagen." };
  }
}

/** Legt eine Markierung (Seite + Notiz + Farbe) an. */
export async function addStatementMarkerAction(formData: FormData): Promise<ActionResult> {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, error: "Nicht angemeldet." };
  const page = Number(formData.get("page"));
  const note = String(formData.get("note") ?? "");
  const color = String(formData.get("color") ?? "red");
  if (!Number.isFinite(page) || page < 1) return { ok: false, error: "Ungültige Seite." };
  if (!note.trim()) return { ok: false, error: "Notiz fehlt." };
  await addStatementMarker({ page, note, color, userId });
  return { ok: true };
}

/** Löscht eine Markierung. */
export async function deleteStatementMarkerAction(id: number): Promise<ActionResult> {
  await deleteStatementMarker(id);
  return { ok: true };
}

/** Zeichnet echte Textmarker-Rechtecke auf eine Seite der Sammel-Datei (einzeln wieder löschbar). */
export async function addPdfHighlightsAction(page: number, rects: HighlightRect[]): Promise<ActionResult> {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, error: "Nicht angemeldet." };
  if (!Number.isFinite(page) || page < 1) return { ok: false, error: "Ungültige Seite." };
  if (!Array.isArray(rects) || rects.length === 0) return { ok: false, error: "Keine Markierung." };
  try {
    await drawStatementHighlights(page, rects, userId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Markieren fehlgeschlagen." };
  }
}

/** Bereits vorhandene Textmarker-Rechtecke einer Seite (zum Anzeigen/Löschen im Markieren-Fenster). */
export async function listPageHighlightsAction(page: number): Promise<StatementHighlight[]> {
  if (!Number.isFinite(page) || page < 1) return [];
  return listStatementHighlights(page);
}

/** Löscht ein Textmarker-Rechteck (baut die angezeigte Datei ohne diese Markierung neu auf). */
export async function deletePdfHighlightAction(id: number): Promise<ActionResult> {
  await deleteStatementHighlight(id);
  return { ok: true };
}

/** Setzt den großen "Geprüft"-Stempel auf eine Seite. */
export async function addStampAction(page: number): Promise<ActionResult> {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, error: "Nicht angemeldet." };
  if (!Number.isFinite(page) || page < 1) return { ok: false, error: "Ungültige Seite." };
  try {
    await addStatementStamp(page, userId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Stempeln fehlgeschlagen." };
  }
}

/** Entfernt einen Stempel. */
export async function deleteStampAction(id: number): Promise<ActionResult> {
  await deleteStatementStamp(id);
  return { ok: true };
}

/** Zeilen-Zuordnungen einer Seite (Rechteck + Soll-Betrag + zugeordnete Belege). */
export async function listPageLinesAction(page: number): Promise<StatementLine[]> {
  if (!Number.isFinite(page) || page < 1) return [];
  return listStatementLines(page);
}

/** Legt eine neue Zeilen-Zuordnung an (Rechteck um eine Kontoauszug-Zeile + Soll-Betrag). */
export async function addLineAction(
  page: number,
  rect: { x: number; y: number; width: number; height: number },
  amount: number
): Promise<ActionResult & { id?: number }> {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, error: "Nicht angemeldet." };
  if (!Number.isFinite(page) || page < 1) return { ok: false, error: "Ungültige Seite." };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Ungültiger Betrag." };
  try {
    const id = await addStatementLine({ page, x: rect.x, y: rect.y, width: rect.width, height: rect.height, amount, userId });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Anlegen fehlgeschlagen." };
  }
}

/** Löscht eine Zeilen-Zuordnung samt zugeordneter Belege. */
export async function deleteLineAction(id: number): Promise<ActionResult> {
  await deleteStatementLine(id);
  return { ok: true };
}

/** Ordnet einer Zeile einen weiteren Beleg zu. */
export async function addReceiptToLineAction(
  lineId: number,
  receipt: AssignableReceiptOption
): Promise<ActionResult> {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, error: "Nicht angemeldet." };
  await addReceiptToLine(lineId, {
    kind: receipt.kind,
    ref: receipt.ref,
    amount: receipt.amount,
    supplier: receipt.supplier,
    invoiceNumber: receipt.invoiceNumber,
  });
  return { ok: true };
}

/** Entfernt einen zugeordneten Beleg von einer Zeile. */
export async function removeReceiptFromLineAction(linkId: number): Promise<ActionResult> {
  await removeReceiptFromLine(linkId);
  return { ok: true };
}

/** Sucht Belege (manuell + HERO) nach Lieferant/Belegnummer, zum Zuordnen zu einer Zeile. */
export async function searchAssignableReceiptsAction(query: string): Promise<AssignableReceiptOption[]> {
  return searchAssignableReceipts(query);
}

/** Liest den Betrag aus dem gezogenen Rechteck per KI aus (zum Vorausfüllen, bleibt korrigierbar). */
export async function extractLineAmountAction(imageBase64Png: string): Promise<{ amount: number | null; error?: string }> {
  const userId = await currentUserId();
  if (userId == null) return { amount: null, error: "Nicht angemeldet." };
  return extractLineAmount(imageBase64Png);
}

/**
 * Legt mehrere automatisch erkannte Zeilen auf einmal an (Erkennung passiert
 * client-seitig über den PDF-Text-Layer). Gibt die Anzahl tatsächlich neu
 * angelegter Zeilen zurück (Dubletten werden übersprungen).
 */
export async function autoDetectLinesAction(
  items: { page: number; x: number; y: number; width: number; height: number; amount: number }[]
): Promise<{ ok: boolean; created?: number; error?: string }> {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, error: "Nicht angemeldet." };
  if (!Array.isArray(items) || items.length === 0) return { ok: true, created: 0 };
  try {
    const created = await addStatementLinesBatch(items, userId);
    return { ok: true, created };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erkennung fehlgeschlagen." };
  }
}
