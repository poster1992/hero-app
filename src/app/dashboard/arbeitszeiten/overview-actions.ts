"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import {
  saveMonthlyField,
  saveDocsComplete,
  addKrankmeldung,
  deleteKrankmeldung,
  setMonthLock,
  type MonthlyField,
} from "@/lib/monthly-overview";

const PATH = "/dashboard/arbeitszeiten";

const VALID_FIELDS: MonthlyField[] = [
  "krank",
  "krank_gesamt",
  "urlaub",
  "urlaub_gesamt",
  "ueberstunden",
  "elternzeit",
  "note",
];

function validPeriod(year: number, month: number, employeeId: number): boolean {
  return (
    Number.isFinite(year) &&
    year > 2000 &&
    year < 2100 &&
    Number.isInteger(month) &&
    month >= 1 &&
    month <= 12 &&
    Number.isFinite(employeeId) &&
    employeeId > 0
  );
}

/** Speichert einen einzelnen Feldwert der Monatsübersicht. */
export async function saveMonthlyFieldAction(
  year: number,
  month: number,
  employeeId: number,
  field: MonthlyField,
  value: string
): Promise<{ ok: boolean }> {
  if (!(await getSession())) return { ok: false };
  if (!validPeriod(year, month, employeeId)) return { ok: false };
  if (!VALID_FIELDS.includes(field)) return { ok: false };
  try {
    await saveMonthlyField(year, month, employeeId, field, value ?? "");
    revalidatePath(PATH);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Sperrt bzw. entsperrt einen Monat (nur Administrator). */
export async function setMonthLockAction(
  year: number,
  month: number,
  locked: boolean
): Promise<{ ok: boolean }> {
  const session = await getSession();
  if (!session || session.role !== "administrator") return { ok: false };
  if (!validPeriod(year, month, 1)) return { ok: false };
  let uid: number | null = null;
  try {
    uid = (await getUserByUsername(session.username))?.id ?? null;
  } catch {
    uid = null;
  }
  try {
    await setMonthLock(year, month, locked, uid);
    revalidatePath(PATH);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Setzt den Status „Unterlagen vollständig" (grün) bzw. „unvollständig" (rot). */
export async function setDocsCompleteAction(
  year: number,
  month: number,
  employeeId: number,
  complete: boolean
): Promise<{ ok: boolean }> {
  if (!(await getSession())) return { ok: false };
  if (!validPeriod(year, month, employeeId)) return { ok: false };
  try {
    await saveDocsComplete(year, month, employeeId, complete);
    revalidatePath(PATH);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Lädt eine Krankmeldung hoch (FormData: year, month, employeeId, file). */
export async function uploadKrankmeldungAction(
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Nicht angemeldet." };

  const year = Number(formData.get("year"));
  const month = Number(formData.get("month"));
  const employeeId = Number(formData.get("employeeId"));
  if (!validPeriod(year, month, employeeId)) return { ok: false, error: "Ungültige Angaben." };

  const upload = formData.get("file");
  if (!upload || typeof upload !== "object" || !("arrayBuffer" in upload) || upload.size === 0) {
    return { ok: false, error: "Keine Datei gewählt." };
  }
  const f = upload as File;
  if (f.size > 15 * 1024 * 1024) return { ok: false, error: "Datei zu groß (max. 15 MB)." };

  let uid: number | null = null;
  try {
    uid = (await getUserByUsername(session.username))?.id ?? null;
  } catch {
    uid = null;
  }

  try {
    await addKrankmeldung(
      year,
      month,
      employeeId,
      {
        buffer: Buffer.from(await f.arrayBuffer()),
        originalName: f.name,
        mime: f.type || "application/octet-stream",
      },
      uid
    );
    revalidatePath(PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Krankmeldung konnte nicht gespeichert werden." };
  }
}

/** Entfernt eine Krankmeldung. */
export async function deleteKrankmeldungAction(id: number): Promise<{ ok: boolean }> {
  if (!(await getSession())) return { ok: false };
  if (!Number.isFinite(id) || id <= 0) return { ok: false };
  try {
    await deleteKrankmeldung(id);
    revalidatePath(PATH);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
