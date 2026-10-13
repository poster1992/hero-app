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
} from "@/lib/fixkosten";

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
  if (!isFixkostenLinkSource(source)) return { ok: false, error: "Unbekannte Verknüpfung." };
  try {
    await createLinkedFixkosten(source);
  } catch {
    return { ok: false, error: "Verknüpfung konnte nicht angelegt werden." };
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
