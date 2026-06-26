"use server";

import { getSession } from "@/lib/session";
import { getCompanyBankInfo } from "@/lib/hero-api";
import {
  listLohnEmployees,
  upsertLohnEmployee,
  deleteLohnEmployee,
} from "@/lib/lohn-employees";
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
  }
  if (payments.length === 0) {
    return { error: "Keine gültigen Mitarbeiter/IBANs für den Export." };
  }

  // Ausführungsdatum: gewählt oder heute (keine Vergangenheit).
  const today = new Date().toISOString().slice(0, 10);
  let executionDate = options.executionDate?.trim() || today;
  if (executionDate < today) executionDate = today;

  const xml = buildSepaCreditTransfer({
    debtorName: company.name || "FLOORTEC",
    debtorIban: company.iban,
    debtorBic: company.bic,
    executionDate,
    msgId: `LOHN-${Date.now()}`,
    payments,
  });

  return {
    xml,
    filename: `lohn-abschlaege-sepa-${executionDate}.xml`,
    count: payments.length,
    total: Math.round(total * 100) / 100,
  };
}
