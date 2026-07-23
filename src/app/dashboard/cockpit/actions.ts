"use server";

import { getSession, getEffectiveRole } from "@/lib/session";
import { getAllowedModules } from "@/lib/role-store";
import { getConfirmationInvoicedReport, type ConfirmationInvoicedReport } from "@/lib/hero-api";

export interface ConfirmationReportState {
  report?: ConfirmationInvoicedReport;
  error?: string;
}

/**
 * Auswertung „Auftragsbestätigungen eines Jahres – wie viel bereits verrechnet".
 * Nur für Benutzer mit Zugriff auf die Unternehmensübersicht (cockpit_uebersicht).
 */
export async function evaluateConfirmationsAction(year: number): Promise<ConfirmationReportState> {
  const session = await getSession();
  if (!session) return { error: "Nicht angemeldet." };

  const { role } = await getEffectiveRole();
  const allowed = await getAllowedModules(role);
  if (!allowed.includes("cockpit_uebersicht")) return { error: "Kein Zugriff auf die Unternehmensübersicht." };

  const currentYear = new Date().getUTCFullYear();
  const y = Number.isFinite(year) ? Math.trunc(year) : currentYear;
  if (y < 2000 || y > currentYear + 1) return { error: "Bitte ein gültiges Jahr angeben." };

  try {
    const report = await getConfirmationInvoicedReport(y);
    return { report };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Auswertung fehlgeschlagen." };
  }
}
