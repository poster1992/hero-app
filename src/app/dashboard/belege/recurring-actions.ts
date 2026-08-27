"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import {
  listRecurring,
  createRecurring,
  updateRecurring,
  setRecurringActive,
  deleteRecurring,
  generateForMonth,
  type RecurringTemplate,
  type RecurringInput,
  type GenerateResult,
} from "@/lib/recurring-receipts";

const PATH = "/dashboard/belege";

export interface RecurringActionResult {
  ok: boolean;
  error?: string;
}

/** Lädt alle Vorlagen (für die Verwaltung). */
export async function listRecurringAction(): Promise<RecurringTemplate[]> {
  if (!(await getSession())) return [];
  try {
    return await listRecurring();
  } catch {
    return [];
  }
}

function parseInput(input: {
  supplier?: string | null;
  description?: string | null;
  gross?: number | string | null;
  vatRate?: number | string | null;
  account?: string | null; // "number|name"
  dayOfMonth?: number | string | null;
  active?: boolean;
}): RecurringInput | { error: string } {
  const grossN = Number(String(input.gross ?? "").toString().replace(",", "."));
  if (!Number.isFinite(grossN) || grossN === 0) return { error: "Bitte einen gültigen Betrag angeben." };
  const vatRaw = String(input.vatRate ?? "").trim().replace(",", ".");
  const vatRate = vatRaw !== "" ? Number(vatRaw) : null;
  if (vatRate != null && !Number.isFinite(vatRate)) return { error: "MwSt-Satz muss eine Zahl sein." };
  const account = String(input.account ?? "").trim();
  const sep = account.indexOf("|");
  const accountNumber = account ? (sep >= 0 ? account.slice(0, sep) : account) : null;
  const accountName = account && sep >= 0 ? account.slice(sep + 1) : "";
  const day = Number(input.dayOfMonth ?? 1);
  return {
    supplier: String(input.supplier ?? "").trim() || null,
    description: String(input.description ?? "").trim() || null,
    gross: Math.round(grossN * 100) / 100,
    vatRate,
    accountNumber,
    accountName,
    dayOfMonth: Number.isFinite(day) ? day : 1,
    active: input.active !== false,
  };
}

/** Legt eine Vorlage an oder aktualisiert sie (id gesetzt → Update). */
export async function saveRecurringAction(input: {
  id?: number | null;
  supplier?: string | null;
  description?: string | null;
  gross?: number | string | null;
  vatRate?: number | string | null;
  account?: string | null;
  dayOfMonth?: number | string | null;
  active?: boolean;
}): Promise<RecurringActionResult> {
  if (!(await getSession())) return { ok: false, error: "Kein Zugriff." };
  const parsed = parseInput(input);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  try {
    if (input.id && Number(input.id) > 0) await updateRecurring(Number(input.id), parsed);
    else await createRecurring(parsed);
  } catch {
    return { ok: false, error: "Speichern fehlgeschlagen." };
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function setRecurringActiveAction(id: number, active: boolean): Promise<RecurringActionResult> {
  if (!(await getSession())) return { ok: false, error: "Kein Zugriff." };
  try {
    await setRecurringActive(id, active);
  } catch {
    return { ok: false, error: "Fehler." };
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteRecurringAction(id: number): Promise<RecurringActionResult> {
  if (!(await getSession())) return { ok: false, error: "Kein Zugriff." };
  try {
    await deleteRecurring(id);
  } catch {
    return { ok: false, error: "Löschen fehlgeschlagen." };
  }
  revalidatePath(PATH);
  return { ok: true };
}

export interface GenerateActionResult extends RecurringActionResult {
  result?: GenerateResult;
}

/** Erzeugt die Belege aller aktiven Vorlagen für den Monat (month 1-basiert). */
export async function generateRecurringAction(year: number, month: number): Promise<GenerateActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Kein Zugriff." };
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return { ok: false, error: "Ungültiger Monat." };
  }
  let uploadedBy: number | null = null;
  try {
    const me = await getUserByUsername(session.username);
    uploadedBy = me?.id ?? null;
  } catch {
    /* uploadedBy optional */
  }
  try {
    const result = await generateForMonth(year, month, uploadedBy);
    revalidatePath(PATH);
    return { ok: true, result };
  } catch {
    return { ok: false, error: "Belege konnten nicht erzeugt werden." };
  }
}
