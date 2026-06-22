import {
  getReceiptsInRange,
  getCustomerInvoices,
  getOfferConfirmationByMonth,
  getBookAccounts,
} from "./hero-api";
import { listManualReceipts } from "./manual-receipts";

const MONTH_LABELS = [
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

export interface MonthlyTotals {
  month: number;
  label: string;
  output: number;
  income: number;
  /** VAT amount from Belege (input tax / Vorsteuer). */
  outputTax: number;
  /** VAT amount from Rechnungen (output tax / Umsatzsteuer). */
  incomeTax: number;
  /** Net sum of offers (Angebote). */
  offers: number;
  /** Net sum of order confirmations (Auftragsbestätigungen). */
  confirmations: number;
}

export interface GuvAccountRow {
  /** Booking account number (Buchungsnummer), or "" if none. */
  accountNumber: string;
  /** Booking account name. */
  accountName: string;
  /** Net amount per month (index 0 = January). */
  monthly: number[];
  total: number;
}

export interface GuvData {
  /** Revenue (Ausgangsrechnungen, net) per month. */
  revenueMonthly: number[];
  revenueTotal: number;
  /** Expense breakdown by booking account (Belege positions, net). */
  expenseAccounts: GuvAccountRow[];
  /** Total expenses per month. */
  expenseMonthly: number[];
  expenseTotal: number;
  /** Result (revenue - expenses) per month. */
  resultMonthly: number[];
  resultTotal: number;
}

export interface DashboardData {
  year: number;
  monthly: MonthlyTotals[];
  totalOutput: number;
  totalIncome: number;
  countOutput: number;
  countIncome: number;
  costRatio: number;
  marginRatio: number;
  /** Offene (unbezahlte) Belege – brutto. Manuelle Belege ohne Bezahlt-Status. */
  openReceiptsTotal: number;
  openReceiptsCount: number;
  /** Offene Belege je Monat (index 0 = Januar). */
  openReceiptsMonthly: MonthlyOpen[];
  /** Einzelne offene Belege (für die Monats-Detailansicht). */
  openReceiptsDetails: OpenDetail[];
  /** Offene (unbezahlte) Ausgangsrechnungen – brutto. */
  openInvoicesTotal: number;
  openInvoicesCount: number;
  /** Offene Rechnungen je Monat (index 0 = Januar). */
  openInvoicesMonthly: MonthlyOpen[];
  /** Einzelne offene Rechnungen (für die Monats-Detailansicht). */
  openInvoicesDetails: OpenDetail[];
  guv: GuvData;
}

export interface MonthlyOpen {
  month: number;
  label: string;
  count: number;
  /** Offene Summe (brutto). */
  total: number;
}

export interface OpenDetail {
  /** Month 1–12. */
  month: number;
  date: string | null;
  /** Document number, or "" for manual receipts without a number. */
  number: string;
  /** Supplier (Belege) or customer (Rechnungen). */
  party: string;
  /** Open amount (brutto). */
  amount: number;
}

const NO_ACCOUNT_LABEL = "Ohne Buchungskonto";
const KEY_SEP = "␟";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Unique map key for a booking account (number + name kept separable). */
function accountKey(number: string, name: string): string {
  return number || name ? `${number}${KEY_SEP}${name}` : `${KEY_SEP}${NO_ACCOUNT_LABEL}`;
}

export async function getDashboardData(year: number): Promise<DashboardData> {
  const from = `${year}-01-01T00:00:00Z`;
  const to = `${year}-12-31T23:59:59Z`;
  const [receipts, invoices, offerConfirmation] = await Promise.all([
    getReceiptsInRange(from, to),
    getCustomerInvoices(),
    getOfferConfirmationByMonth(year),
  ]);

  const monthly: MonthlyTotals[] = MONTH_LABELS.map((label, i) => ({
    month: i + 1,
    label,
    output: 0,
    income: 0,
    outputTax: 0,
    incomeTax: 0,
    offers: offerConfirmation.offers[i] ?? 0,
    confirmations: offerConfirmation.confirmations[i] ?? 0,
  }));

  let totalOutput = 0;
  let totalIncome = 0;
  let countOutput = 0;
  let countIncome = 0;
  let openReceiptsTotal = 0;
  let openReceiptsCount = 0;
  let openInvoicesTotal = 0;
  let openInvoicesCount = 0;
  const openReceiptsMonthly: MonthlyOpen[] = MONTH_LABELS.map((label, i) => ({
    month: i + 1,
    label,
    count: 0,
    total: 0,
  }));
  const openInvoicesMonthly: MonthlyOpen[] = MONTH_LABELS.map((label, i) => ({
    month: i + 1,
    label,
    count: 0,
    total: 0,
  }));
  const openReceiptsDetails: OpenDetail[] = [];
  const openInvoicesDetails: OpenDetail[] = [];

  // GuV: expenses per booking account, net, per month.
  const expenseByAccount = new Map<string, number[]>();

  // HERO-Belegpositionen liefern oft keine Konto-Nr. – daher die SKR-Nummer
  // über den Kontonamen aus dem HERO-Kontenrahmen nachschlagen.
  const accountNumberByName = new Map<string, string>();
  try {
    for (const a of await getBookAccounts()) {
      accountNumberByName.set(a.name.trim().toLowerCase(), a.number);
    }
  } catch {
    // Kontenrahmen optional – ohne ihn bleibt die Nummer ggf. leer.
  }

  // Belege = Eingangsrechnungen (Receipt type "output"), netto + Vorsteuer
  for (const receipt of receipts) {
    if (!receipt.receiptDate || receipt.type !== "output") continue;
    const monthIndex = new Date(receipt.receiptDate).getUTCMonth();
    monthly[monthIndex].output += receipt.netValue;
    monthly[monthIndex].outputTax += receipt.value - receipt.netValue;
    totalOutput += receipt.netValue;
    countOutput++;
    if (receipt.openAmount > 0.005) {
      openReceiptsTotal += receipt.openAmount;
      openReceiptsCount++;
      openReceiptsMonthly[monthIndex].count++;
      openReceiptsMonthly[monthIndex].total += receipt.openAmount;
      const party = receipt.customer
        ? receipt.customer.companyName ||
          [receipt.customer.firstName, receipt.customer.lastName].filter(Boolean).join(" ") ||
          "—"
        : "—";
      openReceiptsDetails.push({
        month: monthIndex + 1,
        date: receipt.receiptDate,
        number: receipt.number ?? "",
        party,
        amount: round2(receipt.openAmount),
      });
    }

    for (const p of receipt.receiptPositions) {
      const name = p.bookAccount?.name?.trim() ?? "";
      let number = p.bookAccount?.num?.trim() ?? "";
      if (!number && name) number = accountNumberByName.get(name.toLowerCase()) ?? "";
      const arr = expenseByAccount.get(accountKey(number, name)) ?? new Array(12).fill(0);
      arr[monthIndex] += p.valueExclVat;
      expenseByAccount.set(accountKey(number, name), arr);
    }
  }

  // Manuelle Belege (lokal, unabhängig von HERO) – zählen als Belege (Aufwand):
  // in die Übersicht (Belege/Saldo/Steuer/Monatschart) UND in die GuV (je Konto).
  try {
    const manual = await listManualReceipts(year);
    for (const r of manual) {
      if (!r.date) continue;
      const d = new Date(r.date);
      if (d.getUTCFullYear() !== year) continue;
      const monthIndex = d.getUTCMonth();
      monthly[monthIndex].output += r.net;
      monthly[monthIndex].outputTax += r.vat;
      totalOutput += r.net;
      countOutput++;
      if (!r.isPaid) {
        openReceiptsTotal += r.gross;
        openReceiptsCount++;
        openReceiptsMonthly[monthIndex].count++;
        openReceiptsMonthly[monthIndex].total += r.gross;
        openReceiptsDetails.push({
          month: monthIndex + 1,
          date: r.date,
          number: "",
          party: r.supplier || r.description || "Manueller Beleg",
          amount: round2(r.gross),
        });
      }
      const number = r.accountNumber?.trim() ?? "";
      const name = r.accountName?.trim() ?? "";
      const arr = expenseByAccount.get(accountKey(number, name)) ?? new Array(12).fill(0);
      arr[monthIndex] += r.net;
      expenseByAccount.set(accountKey(number, name), arr);
    }
  } catch {
    // Manuelle Belege sind optional – Fehler hier blockiert das Dashboard nicht.
  }

  // Rechnungen = Kundenrechnungen (customer_documents), netto + Umsatzsteuer
  for (const inv of invoices) {
    if (!inv.date) continue;
    const d = new Date(inv.date);
    if (d.getUTCFullYear() !== year) continue;
    const monthIndex = d.getUTCMonth();
    monthly[monthIndex].income += inv.net;
    monthly[monthIndex].incomeTax += inv.tax;
    totalIncome += inv.net;
    countIncome++;
    if (inv.isOpen === true) {
      openInvoicesTotal += inv.gross;
      openInvoicesCount++;
      openInvoicesMonthly[monthIndex].count++;
      openInvoicesMonthly[monthIndex].total += inv.gross;
      openInvoicesDetails.push({
        month: monthIndex + 1,
        date: inv.date,
        number: inv.number,
        party: inv.customerName || "—",
        amount: round2(inv.gross),
      });
    }
  }

  for (const m of monthly) {
    m.output = round2(m.output);
    m.income = round2(m.income);
    m.outputTax = round2(m.outputTax);
    m.incomeTax = round2(m.incomeTax);
  }

  // Umsatz = Ausgangsrechnungen (income), Kosten = Belege (output).
  const costRatio = totalIncome > 0 ? round2((totalOutput / totalIncome) * 100) : 0;
  const marginRatio =
    totalIncome > 0 ? round2(((totalIncome - totalOutput) / totalIncome) * 100) : 0;

  // --- GuV (Gewinn- und Verlustrechnung), monatlich, nach Buchungskonten ---
  const revenueMonthly = monthly.map((m) => m.income);
  const revenueTotal = round2(revenueMonthly.reduce((s, v) => s + v, 0));

  const expenseAccounts: GuvAccountRow[] = [...expenseByAccount.entries()]
    .map(([key, arr]) => {
      const sep = key.indexOf(KEY_SEP);
      return {
        accountNumber: sep >= 0 ? key.slice(0, sep) : "",
        accountName: sep >= 0 ? key.slice(sep + 1) : key,
        monthly: arr.map(round2),
        total: round2(arr.reduce((s, v) => s + v, 0)),
      };
    })
    .sort((a, b) => b.total - a.total);

  const expenseMonthly = Array.from({ length: 12 }, (_, i) =>
    round2(expenseAccounts.reduce((s, a) => s + a.monthly[i], 0))
  );
  const expenseTotal = round2(expenseMonthly.reduce((s, v) => s + v, 0));
  const resultMonthly = revenueMonthly.map((r, i) => round2(r - expenseMonthly[i]));
  const resultTotal = round2(revenueTotal - expenseTotal);

  const guv: GuvData = {
    revenueMonthly,
    revenueTotal,
    expenseAccounts,
    expenseMonthly,
    expenseTotal,
    resultMonthly,
    resultTotal,
  };

  return {
    year,
    monthly,
    totalOutput: round2(totalOutput),
    totalIncome: round2(totalIncome),
    countOutput,
    countIncome,
    costRatio,
    marginRatio,
    openReceiptsTotal: round2(openReceiptsTotal),
    openReceiptsCount,
    openReceiptsMonthly: openReceiptsMonthly.map((m) => ({ ...m, total: round2(m.total) })),
    openReceiptsDetails,
    openInvoicesTotal: round2(openInvoicesTotal),
    openInvoicesCount,
    openInvoicesMonthly: openInvoicesMonthly.map((m) => ({ ...m, total: round2(m.total) })),
    openInvoicesDetails,
    guv,
  };
}
