"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getAllowedModules } from "@/lib/role-store";
import { setLeasingMonthPaid, setVehicleLeasingFinalPaid } from "@/lib/vehicles";

const PATH = "/dashboard/fahrzeug-leasing";
const MODULE = "cockpit_fahrzeug_leasing";

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

/** Markiert/entmarkiert die monatliche Leasingrate eines Fahrzeugs als bezahlt. */
export async function setLeasingMonthPaidAction(
  vehicleId: number,
  year: number,
  month: number,
  paid: boolean
): Promise<ActionResult> {
  const user = await requireAccess();
  if (!user) return { ok: false, error: "Kein Zugriff." };
  try {
    await setLeasingMonthPaid(vehicleId, year, month, paid, user.id);
  } catch {
    return { ok: false, error: "Status konnte nicht gespeichert werden." };
  }
  revalidatePath(PATH);
  return { ok: true };
}

/** Markiert/entmarkiert die einmalige Restrate (Schlussrate) eines Fahrzeugs als bezahlt. */
export async function setLeasingFinalPaidAction(vehicleId: number, paid: boolean): Promise<ActionResult> {
  const user = await requireAccess();
  if (!user) return { ok: false, error: "Kein Zugriff." };
  try {
    await setVehicleLeasingFinalPaid(vehicleId, paid);
  } catch {
    return { ok: false, error: "Status konnte nicht gespeichert werden." };
  }
  revalidatePath(PATH);
  revalidatePath("/dashboard/fahrzeuge");
  return { ok: true };
}
