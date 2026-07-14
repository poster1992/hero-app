"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import {
  addBaustellenBeleg,
  deleteBaustellenBeleg,
  setBaustellenBelegPaid,
  setBaustellenBelegAmount,
} from "@/lib/baustellen-belege";
import { ocrBaustellenBeleg } from "@/lib/baustellen-beleg-ocr";
import { getBaustelle } from "@/lib/baustellen-docs";
import { uploadProjectPhoto } from "@/lib/hero-api";

/**
 * Lädt Fotos zu einem Baustellen-Ordner direkt nach HERO hoch (FormData: baustelleId, files).
 * Die Fotos landen am HERO-Projekt in der Bild-Kategorie des Ordners und werden danach
 * von der Galerie wieder live aus HERO gelesen – wir speichern sie nirgends selbst.
 */
export async function uploadBaustellenFotosAction(
  formData: FormData
): Promise<{ ok: boolean; uploaded: number; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, uploaded: 0, error: "Nicht angemeldet." };

  const baustelleId = Number(formData.get("baustelleId"));
  if (!Number.isFinite(baustelleId) || baustelleId <= 0) {
    return { ok: false, uploaded: 0, error: "Ungültiger Ordner." };
  }

  const baustelle = await getBaustelle(baustelleId);
  if (!baustelle) return { ok: false, uploaded: 0, error: "Ordner nicht gefunden." };

  const files = formData
    .getAll("files")
    .filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && f.size > 0);
  if (files.length === 0) return { ok: false, uploaded: 0, error: "Kein Foto gewählt." };

  let uploaded = 0;
  const failed: string[] = [];

  for (const f of files) {
    if (!f.type.startsWith("image/")) {
      failed.push(`${f.name} (kein Bild)`);
      continue;
    }
    if (f.size > 25 * 1024 * 1024) {
      failed.push(`${f.name} (größer als 25 MB)`);
      continue;
    }
    try {
      await uploadProjectPhoto(baustelle.projectMatchId, baustelle.imageCategory, {
        buffer: Buffer.from(await f.arrayBuffer()),
        filename: f.name || "foto.jpg",
        mime: f.type,
      });
      uploaded++;
    } catch (e) {
      failed.push(`${f.name} (${e instanceof Error ? e.message : "Fehler"})`);
    }
  }

  revalidatePath(`/dashboard/baustellen/${baustelleId}`);

  if (uploaded === 0) {
    return { ok: false, uploaded, error: `Upload fehlgeschlagen: ${failed.join(", ")}` };
  }
  if (failed.length > 0) {
    return { ok: true, uploaded, error: `${failed.length} nicht hochgeladen: ${failed.join(", ")}` };
  }
  return { ok: true, uploaded };
}

/** Lädt einen Beleg zu einem Baustellen-Ordner hoch (FormData: baustelleId, file). */
export async function uploadBaustellenBelegAction(
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Nicht angemeldet." };

  const baustelleId = Number(formData.get("baustelleId"));
  if (!Number.isFinite(baustelleId) || baustelleId <= 0) return { ok: false, error: "Ungültiger Ordner." };

  const upload = formData.get("file");
  if (!upload || typeof upload !== "object" || !("arrayBuffer" in upload) || upload.size === 0) {
    return { ok: false, error: "Keine Datei gewählt." };
  }
  const f = upload as File;
  if (f.size > 25 * 1024 * 1024) return { ok: false, error: "Datei zu groß (max. 25 MB)." };

  let uid: number | null = null;
  try {
    uid = (await getUserByUsername(session.username))?.id ?? null;
  } catch {
    uid = null;
  }

  try {
    const belegId = await addBaustellenBeleg(
      baustelleId,
      {
        buffer: Buffer.from(await f.arrayBuffer()),
        originalName: f.name,
        mime: f.type || "application/octet-stream",
      },
      uid
    );
    // OCR direkt mitlaufen lassen (eigenständig, nur dieser Beleg – best effort).
    try {
      await ocrBaustellenBeleg(belegId);
    } catch {
      // OCR-Fehler blockiert den Upload nicht.
    }
    revalidatePath(`/dashboard/baustellen/${baustelleId}/belege`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Beleg konnte nicht gespeichert werden." };
  }
}

/** Setzt/korrigiert den Betrag eines Belegs manuell. */
export async function setBaustellenBelegAmountAction(
  id: number,
  amount: number | null,
  baustelleId: number
): Promise<{ ok: boolean }> {
  if (!(await getSession())) return { ok: false };
  if (!Number.isFinite(id) || id <= 0) return { ok: false };
  const amt =
    amount != null && Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : null;
  try {
    await setBaustellenBelegAmount(id, amt);
    revalidatePath(`/dashboard/baustellen/${baustelleId}/belege`);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Setzt den Bezahlstatus eines Belegs (bezahlt/offen). */
export async function setBaustellenBelegPaidAction(
  id: number,
  paid: boolean,
  baustelleId: number
): Promise<{ ok: boolean }> {
  if (!(await getSession())) return { ok: false };
  if (!Number.isFinite(id) || id <= 0) return { ok: false };
  try {
    await setBaustellenBelegPaid(id, paid);
    revalidatePath(`/dashboard/baustellen/${baustelleId}/belege`);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** OCR für einen Beleg (erneut) ausführen. */
export async function reocrBaustellenBelegAction(
  id: number,
  baustelleId: number
): Promise<{ ok: boolean; error?: string }> {
  if (!(await getSession())) return { ok: false, error: "Nicht angemeldet." };
  if (!Number.isFinite(id) || id <= 0) return { ok: false };
  const res = await ocrBaustellenBeleg(id);
  revalidatePath(`/dashboard/baustellen/${baustelleId}/belege`);
  return res;
}

/** Entfernt einen Beleg. */
export async function deleteBaustellenBelegAction(
  id: number,
  baustelleId: number
): Promise<{ ok: boolean }> {
  if (!(await getSession())) return { ok: false };
  if (!Number.isFinite(id) || id <= 0) return { ok: false };
  try {
    await deleteBaustellenBeleg(id);
    revalidatePath(`/dashboard/baustellen/${baustelleId}/belege`);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
