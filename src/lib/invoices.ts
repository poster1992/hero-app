import {
  getReceiptsInRange,
  getCustomerInvoices,
  type Receipt,
  type ReceiptType,
  type ReceiptProjectMatch,
  type CustomerInvoice,
} from "./hero-api";

/** URL of the internal proxy that streams a HERO document (PDF/image) with auth. */
export function getDocumentUrl(src: string): string {
  return `/api/document?src=${encodeURIComponent(src)}`;
}

/** Distinct projects linked to a receipt's positions. */
export function getReceiptProjects(receipt: Receipt): ReceiptProjectMatch[] {
  const seen = new Map<number, ReceiptProjectMatch>();
  for (const p of receipt.receiptPositions) {
    if (p.projectMatch && !seen.has(p.projectMatch.id)) {
      seen.set(p.projectMatch.id, p.projectMatch);
    }
  }
  return [...seen.values()];
}

export const MONTH_LABELS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

export const MONTH_LABELS_SHORT = [
  "Jan",
  "Feb",
  "Mär",
  "Apr",
  "Mai",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dez",
];

/** Receipts of a given type for a year, grouped by month (index 0 = January). */
export async function getReceiptsByMonth(
  year: number,
  type: ReceiptType
): Promise<Receipt[][]> {
  const from = `${year}-01-01T00:00:00Z`;
  const to = `${year}-12-31T23:59:59Z`;
  const receipts = await getReceiptsInRange(from, to);

  const byMonth: Receipt[][] = Array.from({ length: 12 }, () => []);
  for (const receipt of receipts) {
    if (receipt.type !== type || !receipt.receiptDate) continue;
    const monthIndex = new Date(receipt.receiptDate).getUTCMonth();
    byMonth[monthIndex].push(receipt);
  }
  return byMonth;
}

export interface TaxRateSummary {
  /** VAT rate in percent (e.g. 19, 7, 0). */
  rate: number;
  net: number;
  tax: number;
  gross: number;
}

export interface ReceiptsSummary {
  count: number;
  netTotal: number;
  taxTotal: number;
  grossTotal: number;
  paidTotal: number;
  openTotal: number;
  /** Tax broken down by VAT rate, descending by rate. */
  taxByRate: TaxRateSummary[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Aggregates totals and a per-VAT-rate tax breakdown over a set of receipts. */
export function summarizeReceipts(receipts: Receipt[]): ReceiptsSummary {
  let netTotal = 0;
  let grossTotal = 0;
  let paidTotal = 0;
  let openTotal = 0;
  const byRate = new Map<number, { net: number; gross: number }>();

  for (const r of receipts) {
    grossTotal += r.value;
    netTotal += r.netValue;
    paidTotal += r.paidSum;
    openTotal += r.openAmount;

    for (const p of r.receiptPositions) {
      const entry = byRate.get(p.vat) ?? { net: 0, gross: 0 };
      entry.net += p.valueExclVat;
      entry.gross += p.valueInclVat;
      byRate.set(p.vat, entry);
    }
  }

  const taxByRate: TaxRateSummary[] = [...byRate.entries()]
    .map(([rate, v]) => ({
      rate,
      net: round2(v.net),
      gross: round2(v.gross),
      tax: round2(v.gross - v.net),
    }))
    .sort((a, b) => b.rate - a.rate);

  return {
    count: receipts.length,
    netTotal: round2(netTotal),
    taxTotal: round2(grossTotal - netTotal),
    grossTotal: round2(grossTotal),
    paidTotal: round2(paidTotal),
    openTotal: round2(openTotal),
    taxByRate,
  };
}

/** Minimal shape of a manual receipt needed to fold it into a receipts summary. */
export interface ManualReceiptLike {
  net: number;
  vat: number;
  gross: number;
  vatRate: number | null;
  isPaid: boolean;
}

/**
 * Folds manually uploaded receipts into a HERO receipts summary so the Belege
 * cards (Gesamtsumme/Steuerlast/Bezahlt/Offen) reflect both sources.
 * Manual receipts have no partial payments: paid → fully paid, otherwise open.
 */
export function mergeManualIntoSummary(
  summary: ReceiptsSummary,
  manual: ManualReceiptLike[]
): ReceiptsSummary {
  let netTotal = summary.netTotal;
  let grossTotal = summary.grossTotal;
  let paidTotal = summary.paidTotal;
  let openTotal = summary.openTotal;
  let count = summary.count;

  const byRate = new Map<number, { net: number; gross: number }>();
  for (const r of summary.taxByRate) byRate.set(r.rate, { net: r.net, gross: r.gross });

  for (const m of manual) {
    count++;
    netTotal += m.net;
    grossTotal += m.gross;
    if (m.isPaid) paidTotal += m.gross;
    else openTotal += m.gross;
    const rate = m.vatRate ?? 0;
    const entry = byRate.get(rate) ?? { net: 0, gross: 0 };
    entry.net += m.net;
    entry.gross += m.gross;
    byRate.set(rate, entry);
  }

  const taxByRate: TaxRateSummary[] = [...byRate.entries()]
    .map(([rate, v]) => ({
      rate,
      net: round2(v.net),
      gross: round2(v.gross),
      tax: round2(v.gross - v.net),
    }))
    .sort((a, b) => b.rate - a.rate);

  return {
    count,
    netTotal: round2(netTotal),
    taxTotal: round2(grossTotal - netTotal),
    grossTotal: round2(grossTotal),
    paidTotal: round2(paidTotal),
    openTotal: round2(openTotal),
    taxByRate,
  };
}

// --- Customer invoices ("Rechnungen") ---------------------------------------

export interface InvoicesSummary {
  count: number;
  netTotal: number;
  taxTotal: number;
  grossTotal: number;
  taxByRate: TaxRateSummary[];
}

/** Customer invoices for a year, grouped by month (index 0 = January). */
export async function getInvoicesByMonth(year: number): Promise<CustomerInvoice[][]> {
  const invoices = await getCustomerInvoices();
  const byMonth: CustomerInvoice[][] = Array.from({ length: 12 }, () => []);
  for (const inv of invoices) {
    if (!inv.date) continue;
    const d = new Date(inv.date);
    if (d.getUTCFullYear() !== year) continue;
    byMonth[d.getUTCMonth()].push(inv);
  }
  return byMonth;
}

/** Aggregates totals and a per-VAT-rate breakdown over a set of customer invoices. */
export function summarizeInvoices(invoices: CustomerInvoice[]): InvoicesSummary {
  let netTotal = 0;
  let taxTotal = 0;
  let grossTotal = 0;
  const byRate = new Map<number, { net: number; tax: number }>();

  for (const inv of invoices) {
    netTotal += inv.net;
    taxTotal += inv.tax;
    grossTotal += inv.gross;
    const rate = inv.net > 0 ? Math.round((inv.tax / inv.net) * 100) : 0;
    const entry = byRate.get(rate) ?? { net: 0, tax: 0 };
    entry.net += inv.net;
    entry.tax += inv.tax;
    byRate.set(rate, entry);
  }

  const taxByRate: TaxRateSummary[] = [...byRate.entries()]
    .map(([rate, v]) => ({
      rate,
      net: round2(v.net),
      tax: round2(v.tax),
      gross: round2(v.net + v.tax),
    }))
    .sort((a, b) => b.rate - a.rate);

  return {
    count: invoices.length,
    netTotal: round2(netTotal),
    taxTotal: round2(taxTotal),
    grossTotal: round2(grossTotal),
    taxByRate,
  };
}

/**
 * Net cost per project: Belege (Receipt type "output") minus supplier credit
 * notes / Gutschriften (Receipt type "income"), summed over all positions.
 */
export async function getCostNetByProject(): Promise<Map<number, number>> {
  const receipts = await getReceiptsInRange(
    "2000-01-01T00:00:00Z",
    "2100-12-31T23:59:59Z"
  );
  const byProject = new Map<number, number>();
  for (const r of receipts) {
    // Belege add to cost; Gutschriften/credit notes (income) reduce it.
    const sign = r.type === "output" ? 1 : r.type === "income" ? -1 : 0;
    if (sign === 0) continue;
    for (const p of r.receiptPositions) {
      if (!p.projectMatch) continue;
      const contribution = sign === 1 ? p.valueExclVat : -Math.abs(p.valueExclVat);
      byProject.set(
        p.projectMatch.id,
        (byProject.get(p.projectMatch.id) ?? 0) + contribution
      );
    }
  }
  for (const [k, v] of byProject) byProject.set(k, round2(v));
  return byProject;
}

/** All receipts of a year that are linked (via a position) to the given project. */
export async function getReceiptsForProject(
  year: number,
  projectId: number
): Promise<Receipt[]> {
  const from = `${year}-01-01T00:00:00Z`;
  const to = `${year}-12-31T23:59:59Z`;
  const receipts = await getReceiptsInRange(from, to);
  return receipts.filter((r) =>
    r.receiptPositions.some((p) => p.projectMatch?.id === projectId)
  );
}

/** Distinct booking accounts referenced by a receipt's positions, formatted "num name". */
export function getReceiptBookAccounts(receipt: Receipt): string[] {
  const seen = new Set<string>();
  for (const p of receipt.receiptPositions) {
    if (!p.bookAccount) continue;
    const label = [p.bookAccount.num, p.bookAccount.name].filter(Boolean).join(" ").trim();
    if (label) seen.add(label);
  }
  return [...seen];
}

// --- ABC analysis (customers by revenue, suppliers by cost) ------------------

export interface AbcEntry {
  name: string;
  value: number;
}

export interface AbcRow extends AbcEntry {
  /** Share of total in percent. */
  share: number;
  /** Cumulative share in percent. */
  cumulative: number;
  klasse: "A" | "B" | "C";
}

/** Revenue per customer (Ausgangsrechnungen, net) for a year. */
export async function getCustomerRevenue(year: number): Promise<AbcEntry[]> {
  const invoices = await getCustomerInvoices();
  const byName = new Map<string, number>();
  for (const inv of invoices) {
    if (!inv.date || new Date(inv.date).getUTCFullYear() !== year) continue;
    const name = inv.customerName || "Unbekannt";
    byName.set(name, (byName.get(name) ?? 0) + inv.net);
  }
  return [...byName.entries()].map(([name, value]) => ({ name, value: round2(value) }));
}

/** Cost per supplier (Belege / Receipt type "output", net) for a year. */
export async function getSupplierCost(year: number): Promise<AbcEntry[]> {
  const receipts = await getReceiptsInRange(
    `${year}-01-01T00:00:00Z`,
    `${year}-12-31T23:59:59Z`
  );
  const byName = new Map<string, number>();
  for (const r of receipts) {
    if (r.type !== "output") continue;
    const name = getCustomerName(r);
    byName.set(name, (byName.get(name) ?? 0) + r.netValue);
  }
  return [...byName.entries()].map(([name, value]) => ({ name, value: round2(value) }));
}

/** Ranks entries by value and assigns ABC classes (A ≤80%, B ≤95%, C rest cumulative). */
export function computeAbc(entries: AbcEntry[]): AbcRow[] {
  const positive = entries.filter((e) => e.value > 0).sort((a, b) => b.value - a.value);
  const total = positive.reduce((s, e) => s + e.value, 0);
  let cumulative = 0;
  return positive.map((e) => {
    const share = total > 0 ? (e.value / total) * 100 : 0;
    cumulative += share;
    const klasse: "A" | "B" | "C" = cumulative <= 80 ? "A" : cumulative <= 95 ? "B" : "C";
    return {
      name: e.name,
      value: round2(e.value),
      share: round2(share),
      cumulative: round2(cumulative),
      klasse,
    };
  });
}

export function getCustomerName(receipt: Receipt): string {
  const customer = receipt.customer;
  if (!customer) return "—";
  if (customer.companyName) return customer.companyName;
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(" ");
  return name || "—";
}

/** Distinkte Lieferantennamen aus Eingangsbelegen der letzten ~2 Jahre (für Auswahllisten). */
export async function getDistinctSuppliers(): Promise<string[]> {
  const now = new Date();
  const from = `${now.getUTCFullYear() - 2}-01-01T00:00:00Z`;
  const to = `${now.getUTCFullYear() + 1}-12-31T23:59:59Z`;
  const receipts = await getReceiptsInRange(from, to);
  const set = new Set<string>();
  for (const r of receipts) {
    if (r.type !== "output") continue;
    const name = getCustomerName(r);
    if (name && name !== "—") set.add(name);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "de"));
}

export type InvoiceStatusTone = "paid" | "open" | "overdue";

export interface InvoiceStatus {
  label: string;
  tone: InvoiceStatusTone;
}

export function getInvoiceStatus(receipt: Receipt): InvoiceStatus {
  if (receipt.openAmount <= 0.005) {
    return { label: "Bezahlt", tone: "paid" };
  }
  if (receipt.dueDate && new Date(receipt.dueDate) < new Date()) {
    return { label: "Überfällig", tone: "overdue" };
  }
  return { label: "Offen", tone: "open" };
}

/**
 * Ab diesem Belegdatum zählt für den Zahlstatus NUR noch der lokale Eintrag
 * (unsere DB), der HERO-Status wird ignoriert. Ohne lokalen Eintrag gilt "Offen".
 */
export const LOCAL_STATUS_FROM = "2026-06-01";

/**
 * Effektiver Zahlstatus eines Belegs: lokaler Override gewinnt immer; ab
 * LOCAL_STATUS_FROM ohne Override = "Offen" (HERO ignoriert); davor der HERO-Status.
 */
export function effectiveReceiptStatus(
  receipt: Receipt,
  overrideStatus: "bezahlt" | "offen" | null
): InvoiceStatus {
  if (overrideStatus) {
    return overrideStatus === "bezahlt"
      ? { label: "Bezahlt", tone: "paid" }
      : { label: "Offen", tone: "open" };
  }
  if ((receipt.receiptDate ?? "").slice(0, 10) >= LOCAL_STATUS_FROM) {
    return { label: "Offen", tone: "open" };
  }
  return getInvoiceStatus(receipt);
}
