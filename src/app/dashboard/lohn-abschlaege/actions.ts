"use server";

import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getCompanyBankInfo } from "@/lib/hero-api";
import {
  listLohnEmployees,
  upsertLohnEmployee,
  deleteLohnEmployee,
} from "@/lib/lohn-employees";
import {
  recordLohnRun,
  listLohnRuns,
  deleteLohnRun,
  type LohnRun,
  type LohnRunPosition,
} from "@/lib/lohn-runs";
import {
  upsertLohnTemplate,
  deleteLohnTemplate,
  type LohnTemplatePosition,
} from "@/lib/lohn-templates";
import { buildSepaCreditTransfer, type SepaPayment } from "@/lib/sepa";

export interface SaveEmployeeState {
  error?: string;
  success?: string;
}

const cleanIban = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/** Mitarbeiter (Name + IBAN/BIC) anlegen oder aktualisieren. */
export async function saveEmployeeAction(
  _prev: SaveEmployeeState,
  formData: FormData
): Promise<SaveEmployeeState> {
  if (!(await getSession())) return { error: "Kein Zugriff." };

  const rawId = String(formData.get("id") ?? "").trim();
  const id = rawId ? Number(rawId) : null;
  const name = String(formData.get("name") ?? "").trim();
  const iban = cleanIban(String(formData.get("iban") ?? ""));
  const bic = String(formData.get("bic") ?? "").trim().toUpperCase() || null;

  if (!name) return { error: "Bitte einen Namen angeben." };
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) {
    return { error: "Ungültige IBAN." };
  }
  if (bic && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(bic)) {
    return { error: "Ungültige BIC." };
  }

  try {
    await upsertLohnEmployee({ id, name, iban, bic });
  } catch {
    return { error: "Speichern fehlgeschlagen." };
  }
  return { success: id ? "Mitarbeiter aktualisiert." : "Mitarbeiter angelegt." };
}

/** Mitarbeiter löschen. */
export async function deleteEmployeeAction(formData: FormData): Promise<void> {
  if (!(await getSession())) return;
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  await deleteLohnEmployee(id);
}

export interface WageItem {
  employeeId: number;
  amount: number;
}

export interface WageSepaResult {
  xml?: string;
  filename?: string;
  count?: number;
  total?: number;
  error?: string;
}

/** Erzeugt die SEPA-Überweisungsdatei (Multiline) für die Lohn-Abschläge. */
export async function buildWageSepaAction(
  items: WageItem[],
  options: { reference: string; executionDate?: string }
): Promise<WageSepaResult> {
  if (!(await getSession())) return { error: "Kein Zugriff." };

  const valid = items.filter((it) => Number.isFinite(it.amount) && it.amount > 0);
  if (valid.length === 0) return { error: "Keine Abschläge mit Betrag erfasst." };

  const reference = (options.reference || "Lohn Abschlag").trim();

  const [company, employees] = await Promise.all([
    getCompanyBankInfo(),
    listLohnEmployees(true),
  ]);
  if (!company.iban) {
    return { error: "Firmen-IBAN (Auftraggeber) fehlt in HERO." };
  }
  const byId = new Map(employees.map((e) => [e.id, e]));

  const payments: SepaPayment[] = [];
  const positions: LohnRunPosition[] = [];
  let total = 0;
  for (const it of valid) {
    const emp = byId.get(it.employeeId);
    if (!emp || !emp.iban) continue;
    total += it.amount;
    payments.push({
      creditorName: emp.name,
      creditorIban: emp.iban,
      creditorBic: emp.bic,
      amount: it.amount,
      reference,
      endToEndId: `LOHN-${emp.id}-${Date.now()}`.slice(0, 35),
    });
    positions.push({ name: emp.name, iban: emp.iban, amount: it.amount });
  }
  if (payments.length === 0) {
    return { error: "Keine gültigen Mitarbeiter/IBANs für den Export." };
  }

  // Ausführungsdatum: gewählt oder heute (keine Vergangenheit).
  const today = new Date().toISOString().slice(0, 10);
  let executionDate = options.executionDate?.trim() || today;
  if (executionDate < today) executionDate = today;

  const debtorName = company.name || "FLOORTEC";
  const xml = buildSepaCreditTransfer({
    debtorName,
    debtorIban: company.iban,
    debtorBic: company.bic,
    executionDate,
    msgId: `LOHN-${Date.now()}`,
    payments,
  });

  const totalRounded = Math.round(total * 100) / 100;

  // Lauf in der Historie aufzeichnen (für spätere PDF-Erstellung).
  try {
    const session = await getSession();
    const userId = session ? (await getUserByUsername(session.username))?.id ?? null : null;
    await recordLohnRun({
      reference,
      executionDate,
      count: payments.length,
      total: totalRounded,
      debtorName,
      positions,
      createdBy: userId,
    });
  } catch {
    // Historie ist optional – ein Fehler hier verhindert den Export nicht.
  }

  return {
    xml,
    filename: `lohn-abschlaege-sepa-${executionDate}.xml`,
    count: payments.length,
    total: totalRounded,
  };
}

/** Historie der erstellten Lohnläufe (neueste zuerst). */
export async function getLohnHistory(): Promise<LohnRun[]> {
  if (!(await getSession())) return [];
  try {
    return await listLohnRuns();
  } catch {
    return [];
  }
}

/** Löscht einen Lohnlauf aus der Historie. */
export async function deleteLohnRunAction(formData: FormData): Promise<void> {
  if (!(await getSession())) return;
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  await deleteLohnRun(id);
}

export interface SaveTemplateResult {
  error?: string;
  success?: string;
}

/** Speichert/überschreibt eine Vorlage (Beträge je Mitarbeiter) per Name. */
export async function saveTemplateAction(input: {
  name: string;
  reference: string;
  positions: LohnTemplatePosition[];
}): Promise<SaveTemplateResult> {
  if (!(await getSession())) return { error: "Kein Zugriff." };
  const name = input.name.trim();
  if (!name) return { error: "Bitte einen Vorlagennamen angeben." };

  const positions = (input.positions ?? []).filter(
    (p) => Number.isFinite(p.employeeId) && p.employeeId > 0 && Number.isFinite(p.amount) && p.amount > 0
  );
  if (positions.length === 0) return { error: "Keine Beträge zum Speichern erfasst." };

  try {
    const session = await getSession();
    const userId = session ? (await getUserByUsername(session.username))?.id ?? null : null;
    await upsertLohnTemplate({
      name,
      reference: input.reference?.trim() || null,
      positions,
      createdBy: userId,
    });
  } catch {
    return { error: "Vorlage konnte nicht gespeichert werden." };
  }
  return { success: `Vorlage „${name}" gespeichert.` };
}

/** Löscht eine Vorlage. */
export async function deleteTemplateAction(formData: FormData): Promise<void> {
  if (!(await getSession())) return;
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  await deleteLohnTemplate(id);
}
