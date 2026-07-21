"use server";

import { getSession } from "@/lib/session";
import { getCompanyBankInfo, getSupplierContacts } from "@/lib/hero-api";
import { getSupplierIbanMap, upsertSupplierIban, setSupplierDirectDebit } from "@/lib/supplier-ibans";
import { buildSepaCreditTransfer, type SepaPayment } from "@/lib/sepa";

/** Normalisiert einen Lieferantennamen für den Abgleich (Groß/Klein, Mehrfach-Leerzeichen). */
const normSupplier = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export interface SepaItem {
  customerId: number | null;
  name: string;
  amount: number;
  reference: string;
  /** HERO-Beleg-ID (für die OCR-Prüfung vor dem Export). */
  heroId?: string;
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
  const rawSkontoDays = String(formData.get("skontoDays") ?? "").trim();
  const skontoDays = rawSkontoDays !== "" ? Number(rawSkontoDays) : null;
  const rawSkontoPercent = String(formData.get("skontoPercent") ?? "").trim().replace(",", ".");
  const skontoPercent = rawSkontoPercent !== "" ? Number(rawSkontoPercent) : null;

  if (!Number.isFinite(customerId)) return { error: "Kein Lieferant." };
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) {
    return { error: "Ungültige IBAN." };
  }
  if (bic && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(bic)) {
    return { error: "Ungültige BIC." };
  }
  if (skontoDays !== null && (!Number.isInteger(skontoDays) || skontoDays < 0 || skontoDays > 365)) {
    return { error: "Ungültige Skontofrist (0–365 Tage)." };
  }
  if (skontoPercent !== null && (!Number.isFinite(skontoPercent) || skontoPercent < 0 || skontoPercent > 100)) {
    return { error: "Ungültiger Skontosatz (0–100 %)." };
  }

  try {
    await upsertSupplierIban({ customerId, supplierName: name, iban, bic, skontoDays, skontoPercent });
  } catch {
    return { error: "Speichern fehlgeschlagen." };
  }
  return { success: "IBAN gespeichert." };
}

export async function setDirectDebitAction(formData: FormData): Promise<void> {
  if (!(await getSession())) return;
  const customerId = Number(formData.get("customerId"));
  const name = String(formData.get("name") ?? "").trim() || null;
  const directDebit = String(formData.get("directDebit")) === "1";
  if (!Number.isFinite(customerId)) return;
  await setSupplierDirectDebit({ customerId, supplierName: name, directDebit });
}

export async function buildMultilineSepaAction(items: SepaItem[]): Promise<SepaResult> {
  if (!(await getSession())) return { missing: [], error: "Kein Zugriff." };
  if (items.length === 0) return { missing: [], error: "Keine Belege ausgewählt." };

  const [company, ibanMap] = await Promise.all([getCompanyBankInfo(), getSupplierIbanMap()]);

  if (!company.iban) {
    return { missing: [], error: "Firmen-IBAN (Auftraggeber) fehlt in HERO." };
  }

  // Manuelle Belege liefern keine HERO-customerId, nur den Lieferantennamen.
  // Diese werden über die HERO-Kontakte (Name → id) auf eine customerId
  // aufgelöst, damit sie dieselbe IBAN-Zuordnung wie HERO-Belege nutzen.
  let nameToId: Map<string, number> | null = null;
  if (items.some((it) => it.customerId == null && it.name)) {
    try {
      const contacts = await getSupplierContacts();
      nameToId = new Map(contacts.map((c) => [normSupplier(c.name), c.id]));
    } catch {
      nameToId = new Map();
    }
  }

  const payments: SepaPayment[] = [];
  const missing: { customerId: number | null; name: string }[] = [];

  for (const it of items) {
    if (it.amount <= 0) continue;
    const customerId = it.customerId ?? (nameToId?.get(normSupplier(it.name)) ?? null);
    const entry = customerId != null ? ibanMap.get(customerId) : undefined;
    // Bankeinzug-Lieferanten werden per Lastschrift gezogen → nicht überweisen.
    if (entry?.directDebit) continue;
    if (!entry || !entry.iban) {
      missing.push({ customerId, name: it.name });
      continue;
    }
    payments.push({
      creditorName: it.name,
      creditorIban: entry.iban,
      creditorBic: entry.bic,
      amount: it.amount,
      reference: it.reference,
      endToEndId: it.reference || `BELEG-${customerId ?? "M"}`,
    });
  }

  if (missing.length > 0) {
    // Erst alle IBANs pflegen, dann exportieren.
    return { missing };
  }

  if (payments.length === 0) {
    return { missing: [], error: "Keine überweisbaren Belege (evtl. alle per Bankeinzug oder Betrag 0)." };
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
