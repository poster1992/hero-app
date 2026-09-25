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
  type HighlightRect,
  type StatementHighlight,
} from "@/lib/kontoauszuege";

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
