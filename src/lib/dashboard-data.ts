import {
  getReceiptsInRange,
  getCustomerInvoices,
  getOfferConfirmationByMonth,
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
  account: string;
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
  guv: GuvData;
}

const NO_ACCOUNT_LABEL = "Ohne Buchungskonto";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
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

  // GuV: expenses per booking account, net, per month.
  const expenseByAccount = new Map<string, number[]>();

  // Belege = Eingangsrechnungen (Receipt type "output"), netto + Vorsteuer
  for (const receipt of receipts) {
    if (!receipt.receiptDate || receipt.type !== "output") continue;
    const monthIndex = new Date(receipt.receiptDate).getUTCMonth();
    monthly[monthIndex].output += receipt.netValue;
    monthly[monthIndex].outputTax += receipt.value - receipt.netValue;
    totalOutput += receipt.netValue;
    countOutput++;

    for (const p of receipt.receiptPositions) {
      const account = p.bookAccount
        ? [p.bookAccount.num, p.bookAccount.name].filter(Boolean).join(" ").trim() ||
          NO_ACCOUNT_LABEL
        : NO_ACCOUNT_LABEL;
      const arr = expenseByAccount.get(account) ?? new Array(12).fill(0);
      arr[monthIndex] += p.valueExclVat;
      expenseByAccount.set(account, arr);
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
      const account =
        [r.accountNumber, r.accountName].filter(Boolean).join(" ").trim() || NO_ACCOUNT_LABEL;
      const arr = expenseByAccount.get(account) ?? new Array(12).fill(0);
      arr[monthIndex] += r.net;
      expenseByAccount.set(account, arr);
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
    .map(([account, arr]) => ({
      account,
      monthly: arr.map(round2),
      total: round2(arr.reduce((s, v) => s + v, 0)),
    }))
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
    guv,
  };
}
