"use server";

import { getSession } from "@/lib/session";
import { getCompanyBankInfo } from "@/lib/hero-api";
import { getSupplierIbanMap, upsertSupplierIban } from "@/lib/supplier-ibans";
import { buildSepaCreditTransfer, type SepaPayment } from "@/lib/sepa";

export interface SepaItem {
  customerId: number | null;
  name: string;
  amount: number;
  reference: string;
}

export interface SepaResult {
  xml?: string;
  filename?: string;
  /** Lieferanten ohne hinterlegte IBAN (müssen erst gepflegt werden). */
  missing: { customerId: number | null; name: string }[];
  error?: string;
}

export interface SaveIbanState {
  error?: string;
  success?: string;
}

const cleanIban = (s: string) => s.replace(/\s+/g, "").toUpperCase();

export async function saveSupplierIbanAction(
  _prev: SaveIbanState,
  formData: FormData
): Promise<SaveIbanState> {
  if (!(await getSession())) return { error: "Kein Zugriff." };

  const customerId = Number(formData.get("customerId"));
  const name = String(formData.get("name") ?? "").trim() || null;
  const iban = cleanIban(String(formData.get("iban") ?? ""));
  const bic = String(formData.get("bic") ?? "").trim().toUpperCase() || null;

  if (!Number.isFinite(customerId)) return { error: "Kein Lieferant." };
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) {
    return { error: "Ungültige IBAN." };
  }
  if (bic && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(bic)) {
    return { error: "Ungültige BIC." };
  }

  try {
    await upsertSupplierIban({ customerId, supplierName: name, iban, bic });
  } catch {
    return { error: "Speichern fehlgeschlagen." };
  }
  return { success: "IBAN gespeichert." };
}

export async function buildMultilineSepaAction(items: SepaItem[]): Promise<SepaResult> {
  if (!(await getSession())) return { missing: [], error: "Kein Zugriff." };
  if (items.length === 0) return { missing: [], error: "Keine Belege ausgewählt." };

  const [company, ibanMap] = await Promise.all([getCompanyBankInfo(), getSupplierIbanMap()]);

  if (!company.iban) {
    return { missing: [], error: "Firmen-IBAN (Auftraggeber) fehlt in HERO." };
  }

  const payments: SepaPayment[] = [];
  const missing: { customerId: number | null; name: string }[] = [];

  for (const it of items) {
    if (it.amount <= 0) continue;
    const entry = it.customerId != null ? ibanMap.get(it.customerId) : undefined;
    if (!entry) {
      missing.push({ customerId: it.customerId, name: it.name });
      continue;
    }
    payments.push({
      creditorName: it.name,
      creditorIban: entry.iban,
      creditorBic: entry.bic,
      amount: it.amount,
      reference: it.reference,
      endToEndId: it.reference || `BELEG-${it.customerId}`,
    });
  }

  if (missing.length > 0) {
    // Erst alle IBANs pflegen, dann exportieren.
    return { missing };
  }

  const today = new Date().toISOString().slice(0, 10);
  const xml = buildSepaCreditTransfer({
    debtorName: company.name || "FLOORTEC",
    debtorIban: company.iban,
    debtorBic: company.bic,
    executionDate: today,
    msgId: `FLOORTEC-${Date.now()}`,
    payments,
  });

  return { missing: [], xml, filename: `multiline-sepa-${today}.xml` };
}
