"use server";

import { revalidatePath } from "next/cache";
import { getEffectiveRole } from "@/lib/session";
import { getAllowedModules } from "@/lib/role-store";
import { confirmWorkdays, getWorkdays, getWorkdayTimesByDate, type WorkdayTime } from "@/lib/hero-api";

const MODULE = "cockpit_zeitfreigabe";

/** Prüft, ob die aktuelle Rolle die Arbeitszeit-Freigabe nutzen darf. */
async function mayApprove(): Promise<boolean> {
  const { role } = await getEffectiveRole();
  if (role === "administrator") return true;
  try {
    return (await getAllowedModules(role)).includes(MODULE);
  } catch {
    return false;
  }
}

/**
 * Lädt die einzelnen Zeitabschnitte eines Arbeitstags (für die Detailansicht beim Klick).
 * Gibt sie nach Workday-ID gruppiert zurück, damit ein Klick auf einen Mitarbeiter dessen
 * Tag sofort aus dem Ergebnis ziehen kann (ein Datum teilt sich über alle Mitarbeiter).
 */
export async function loadWorkdayTimesAction(
  date: string
): Promise<{ ok: boolean; times?: Record<number, WorkdayTime[]>; error?: string }> {
  if (!(await mayApprove())) return { ok: false, error: "Kein Zugriff." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Ungültiges Datum." };
  try {
    const map = await getWorkdayTimesByDate(date);
    return { ok: true, times: Object.fromEntries(map) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Details konnten nicht geladen werden." };
  }
}

/**
 * Gibt Arbeitstage in HERO frei und meldet zurück, welche danach WIRKLICH bestätigt sind.
 *
 * `confirm_tracking_workdays` liefert auch für nicht existierende IDs `true` – deshalb
 * verlassen wir uns nicht auf den Rückgabewert, sondern lesen den Status frisch nach
 * und melden nur die tatsächlich auf „freigegeben" gewechselten Tage.
 */
export async function confirmWorkdaysAction(input: {
  ids: number[];
  from: string;
  to: string;
}): Promise<{ ok: boolean; confirmed: number; error?: string }> {
  if (!(await mayApprove())) return { ok: false, confirmed: 0, error: "Kein Zugriff." };

  const ids = (input.ids ?? []).filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length === 0) return { ok: false, confirmed: 0, error: "Keine Tage ausgewählt." };

  try {
    await confirmWorkdays(ids);
  } catch (e) {
    return { ok: false, confirmed: 0, error: e instanceof Error ? e.message : "HERO-Fehler." };
  }

  // Gegenprobe: welche der angeforderten Tage sind jetzt wirklich bestätigt?
  let confirmed = 0;
  try {
    const after = await getWorkdays(input.from, input.to);
    const byId = new Map(after.map((w) => [w.id, w]));
    confirmed = ids.filter((id) => byId.get(id)?.confirmed).length;
  } catch {
    // Wenn das Nachlesen scheitert, gilt der Mutations-Aufruf als erfolgt (best effort).
    confirmed = ids.length;
  }

  revalidatePath("/dashboard/zeitfreigabe");

  if (confirmed === 0) {
    return { ok: false, confirmed: 0, error: "HERO hat die Tage nicht als freigegeben bestätigt." };
  }
  return { ok: true, confirmed };
}
