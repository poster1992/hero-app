"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getAllowedModules } from "@/lib/role-store";
import {
  createFixkosten,
  updateFixkosten,
  deleteFixkosten,
  createLinkedFixkosten,
  isFixkostenLinkSource,
  isModuleLinkSource,
  searchReceiptsForFixkosten,
  addReceiptToFixkosten,
  removeFixkostenReceiptLink,
  saveFixkostenSnapshot,
  setFixkostenOverride,
  type FixkostenReceiptOption,
} from "@/lib/fixkosten";
import { getLineReceiptFileUrl } from "@/lib/kontoauszuege";

const PATH = "/dashboard/fixkosten";
const MODULE = "cockpit_fixkosten";

async function requireAccess() {
  const session = await getSession();
  if (!session) return null;
  const user = await getUserByUsername(session.username);
  if (!user) return null;
  const allowed = await getAllowedModules(user.role);
  if (!allowed.includes(MODULE)) return null;
  return user;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Parst ein Betragsfeld (deutsches Format, z. B. "450,00"). */
function parseAmount(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Zerlegt das Hidden-Input-Format "nummer|name" (wie bei ManualBelegeForm). */
function parseAccount(raw: string): { number: string | null; name: string | null } {
  const s = raw.trim();
  if (!s) return { number: null, name: null };
  const sep = s.indexOf("|");
  return sep >= 0 ? { number: s.slice(0, sep), name: s.slice(sep + 1) } : { number: s, name: null };
}

export async function createFixkostenAction(formData: FormData): Promise<ActionResult> {
  if (!(await requireAccess())) return { ok: false, error: "Kein Zugriff." };
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Bitte eine Bezeichnung angeben." };
  const amount = parseAmount(String(formData.get("monthlyAmount") ?? ""));
  if (amount == null) return { ok: false, error: "Bitte einen gültigen Betrag angeben." };
  const account = parseAccount(String(formData.get("account") ?? ""));
  try {
    await createFixkosten(name, amount, account.number, account.name);
  } catch {
    return { ok: false, error: "Fixkosten-Position konnte nicht angelegt werden." };
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function updateFixkostenAction(
  id: number,
  name: string,
  monthlyAmount: string,
  accountRaw: string
): Promise<ActionResult> {
  if (!(await requireAccess())) return { ok: false, error: "Kein Zugriff." };
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "Ungültige Position." };
  const clean = name.trim();
  if (!clean) return { ok: false, error: "Bitte eine Bezeichnung angeben." };
  const amount = parseAmount(monthlyAmount);
  if (amount == null) return { ok: false, error: "Bitte einen gültigen Betrag angeben." };
  const account = parseAccount(accountRaw);
  try {
    await updateFixkosten(id, clean, amount, account.number, account.name);
  } catch {
    return { ok: false, error: "Konnte nicht gespeichert werden." };
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function createLinkedFixkostenAction(source: string): Promise<ActionResult> {
  if (!(await requireAccess())) return { ok: false, error: "Kein Zugriff." };
  if (!isFixkostenLinkSource(source) || !isModuleLinkSource(source)) {
    return { ok: false, error: "Unbekannte Verknüpfung." };
  }
  try {
    await createLinkedFixkosten(source);
  } catch {
    return { ok: false, error: "Verknüpfung konnte nicht angelegt werden." };
  }
  revalidatePath(PATH);
  return { ok: true };
}

/** Sucht Belege zum Verknüpfen mit einer Fixkosten-Position. */
export async function searchFixkostenReceiptsAction(
  query: string
): Promise<{ results: FixkostenReceiptOption[]; error?: string }> {
  if (!(await requireAccess())) return { results: [], error: "Kein Zugriff." };
  return searchReceiptsForFixkosten(query);
}

/** Hängt einen gefundenen Beleg an eine Fixkosten-Position. */
export async function addFixkostenReceiptAction(
  fixkostenId: number,
  option: FixkostenReceiptOption
): Promise<ActionResult> {
  if (!(await requireAccess())) return { ok: false, error: "Kein Zugriff." };
  if (!Number.isFinite(fixkostenId) || fixkostenId <= 0) return { ok: false, error: "Ungültige Position." };
  try {
    await addReceiptToFixkosten(fixkostenId, option);
  } catch {
    return { ok: false, error: "Beleg konnte nicht verknüpft werden." };
  }
  revalidatePath(PATH);
  return { ok: true };
}

/** Entfernt eine Beleg-Verknüpfung. */
export async function removeFixkostenReceiptLinkAction(linkId: number): Promise<ActionResult> {
  if (!(await requireAccess())) return { ok: false, error: "Kein Zugriff." };
  if (!Number.isFinite(linkId) || linkId <= 0) return { ok: false, error: "Ungültige Verknüpfung." };
  try {
    await removeFixkostenReceiptLink(linkId);
  } catch {
    return { ok: false, error: "Konnte nicht entfernt werden." };
  }
  revalidatePath(PATH);
  return { ok: true };
}

/** Löst die Dokument-URL eines verknüpften Belegs auf (manuell oder HERO), für den Klick-zum-Öffnen. */
export async function getFixkostenReceiptFileUrlAction(
  kind: "manual" | "hero",
  ref: string
): Promise<{ url: string | null; error?: string }> {
  if (!(await requireAccess())) return { url: null, error: "Kein Zugriff." };
  return getLineReceiptFileUrl(kind, ref);
}

/** Sichert den aktuellen Stand aller Fixkosten-Positionen für den laufenden Monat (überschreibt einen evtl. bereits vorhandenen). */
export async function saveFixkostenSnapshotAction(): Promise<ActionResult> {
  const user = await requireAccess();
  if (!user) return { ok: false, error: "Kein Zugriff." };
  const now = new Date();
  try {
    await saveFixkostenSnapshot(now.getFullYear(), now.getMonth() + 1, user.id, false);
  } catch {
    return { ok: false, error: "Stand konnte nicht gesichert werden." };
  }
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Setzt/entfernt einen manuellen Wert und/oder eine Notiz für eine Position in
 * einem Zukunftsmonat (z. B. Lohnkosten reduzieren + begründen, weil ein
 * Mitarbeiter gekündigt hat). Leerer Betrag = keine Übersteuerung (Betrag bleibt
 * die automatische Prognose), leere Notiz = keine Notiz. Sind beide leer, wird
 * ein evtl. vorhandener Eintrag wieder entfernt.
 */
export async function setFixkostenOverrideAction(
  name: string,
  year: number,
  month: number,
  amountRaw: string,
  noteRaw: string
): Promise<ActionResult> {
  if (!(await requireAccess())) return { ok: false, error: "Kein Zugriff." };
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return { ok: false, error: "Ungültiger Monat." };
  }
  const trimmed = amountRaw.trim();
  const amount = trimmed ? parseAmount(trimmed) : null;
  if (trimmed && amount == null) return { ok: false, error: "Bitte einen gültigen Betrag angeben." };
  try {
    await setFixkostenOverride(name, year, month, amount, noteRaw);
  } catch {
    return { ok: false, error: "Konnte nicht gespeichert werden." };
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteFixkostenAction(id: number): Promise<ActionResult> {
  if (!(await requireAccess())) return { ok: false, error: "Kein Zugriff." };
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "Ungültige Position." };
  try {
    await deleteFixkosten(id);
  } catch {
    return { ok: false, error: "Konnte nicht gelöscht werden." };
  }
  revalidatePath(PATH);
  return { ok: true };
}
