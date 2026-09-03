"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getAllowedModules } from "@/lib/role-store";
import { sniffMime } from "@/lib/file-sniff";
import {
  createAufmass,
  deleteAufmass,
  getAufmass,
  getAufmassSource,
  listAufmasse,
  saveAufmassResult,
  setAufmassError,
} from "@/lib/aufmass";
import { extractAufmass } from "@/lib/aufmass-extract";
import { aufmassDocxFileName, buildAufmassDocx } from "@/lib/aufmass-docx";
import type { AufmassEntry } from "@/lib/aufmass-types";

const PATH = "/dashboard/aufmass";
const MAX_BYTES = 25 * 1024 * 1024;

/** Angemeldeter Benutzer mit Recht „cockpit_aufmass" (sonst null). */
async function authorized() {
  const session = await getSession();
  if (!session) return null;
  const user = await getUserByUsername(session.username);
  if (!user) return null;
  const allowed = await getAllowedModules(user.role);
  if (!allowed.includes("cockpit_aufmass")) return null;
  return user;
}

export interface AufmassUploadResult {
  ok: boolean;
  id?: number;
  error?: string;
  /** Anzahl erkannter Positionen (für die Rückmeldung). */
  positions?: number;
}

/**
 * Nimmt ein handschriftliches Aufmaß entgegen, liest es aus und erzeugt daraus
 * das bearbeitbare Word-Dokument. Läuft bewusst im Vordergrund (Ergebnis direkt
 * nach dem Hochladen sichtbar); die Datei bleibt auch bei Fehlern erhalten.
 */
export async function uploadAufmassAction(formData: FormData): Promise<AufmassUploadResult> {
  const user = await authorized();
  if (!user) return { ok: false, error: "Kein Zugriff." };

  const upload = formData.get("file");
  if (!upload || typeof upload !== "object" || !("arrayBuffer" in upload)) {
    return { ok: false, error: "Keine Datei erhalten." };
  }
  const f = upload as File;
  if (f.size === 0) return { ok: false, error: "Die Datei ist leer." };
  if (f.size > MAX_BYTES) return { ok: false, error: "Datei zu groß (max. 25 MB)." };

  const buffer = Buffer.from(await f.arrayBuffer());
  // MIME aus dem Inhalt bestimmen – Handy-Uploads liefern oft nur octet-stream.
  const mime = sniffMime(buffer, f.type || "application/octet-stream");

  let id: number;
  try {
    id = await createAufmass({ buffer, originalName: f.name, mime }, user.id);
  } catch (e) {
    // Grund mitloggen – sonst ist im Fehlerfall (Rechte am Volume, DB) nicht
    // erkennbar, woran es lag.
    console.error("[aufmass] Speichern fehlgeschlagen:", e);
    const reason = e instanceof Error ? e.message : "";
    return {
      ok: false,
      error: `Datei konnte nicht gespeichert werden.${reason ? ` (${reason})` : ""}`,
    };
  }

  const result = await processAufmass(id);
  revalidatePath(PATH);
  return result.ok ? { ok: true, id, positions: result.positions } : { ok: false, id, error: result.error };
}

/** Wertet ein gespeichertes Aufmaß (neu) aus und baut das Word-Dokument. */
async function processAufmass(id: number): Promise<{ ok: true; positions: number } | { ok: false; error: string }> {
  const entry = await getAufmass(id);
  const source = await getAufmassSource(id);
  if (!entry || !source) {
    await setAufmassError(id, "Originaldatei nicht gefunden.");
    return { ok: false, error: "Originaldatei nicht gefunden." };
  }

  const extracted = await extractAufmass({ data: source.data, mime: source.mime });
  if (!extracted.ok) {
    await setAufmassError(id, extracted.error);
    return { ok: false, error: extracted.error };
  }
  if (extracted.data.positions.length === 0 && !extracted.data.transcript) {
    const msg = "Auf dem Dokument war kein Aufmaß erkennbar.";
    await setAufmassError(id, msg);
    return { ok: false, error: msg };
  }

  try {
    const docx = await buildAufmassDocx(extracted.data, {
      sourceFileName: entry.fileName,
      createdByName: entry.createdByName,
    });
    await saveAufmassResult(id, extracted.data, {
      buffer: docx,
      fileName: aufmassDocxFileName(extracted.data),
    });
  } catch {
    const msg = "Word-Dokument konnte nicht erzeugt werden.";
    await setAufmassError(id, msg);
    return { ok: false, error: msg };
  }
  return { ok: true, positions: extracted.data.positions.length };
}

/** Erneut auswerten (z. B. nach einem Fehler) – ersetzt das Word-Dokument. */
export async function reprocessAufmassAction(id: number): Promise<AufmassUploadResult> {
  const user = await authorized();
  if (!user) return { ok: false, error: "Kein Zugriff." };
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "Ungültiges Aufmaß." };
  const res = await processAufmass(id);
  revalidatePath(PATH);
  return res.ok ? { ok: true, id, positions: res.positions } : { ok: false, id, error: res.error };
}

/** Löscht ein Aufmaß samt Originaldatei und Word-Dokument. */
export async function deleteAufmassAction(id: number): Promise<void> {
  const user = await authorized();
  if (!user) return;
  if (!Number.isFinite(id) || id <= 0) return;
  await deleteAufmass(id);
  revalidatePath(PATH);
}

/** Aktuelle Liste (nach dem Hochladen/Löschen im Client nachladen). */
export async function listAufmasseAction(): Promise<AufmassEntry[]> {
  const user = await authorized();
  if (!user) return [];
  return listAufmasse().catch(() => []);
}
