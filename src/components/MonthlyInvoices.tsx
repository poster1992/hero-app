import Link from "next/link";
import YearSelector from "@/components/YearSelector";
import MonthTabs from "@/components/MonthTabs";
import InvoicesSummaryPanel from "@/components/InvoicesSummaryPanel";
import ReceiptsTableClient, { type ReceiptRow } from "@/components/ReceiptsTableClient";
import { getInvoicesByMonth, summarizeInvoices, getDocumentUrl, MONTH_LABELS } from "@/lib/invoices";
import type { CustomerInvoice } from "@/lib/hero-api";
import type { InvoiceStatusTone } from "@/lib/invoices";

const currencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

const dateFormatter = new Intl.DateTimeFormat("de-DE");

export type InvoicesView = "month" | "all";

const VIEW_OPTIONS: { value: InvoicesView; label: string }[] = [
  { value: "month", label: "Monatlich" },
  { value: "all", label: "Alle" },
];

function statusToTone(status: string | null): InvoiceStatusTone {
  const s = (status ?? "").toLowerCase();
  if (s.includes("storn") || s.includes("lösch") || s.includes("losch")) return "overdue";
  if (s.includes("versend") || s.includes("bezahl")) return "paid";
  return "open";
}

/** Zahlungsstatus aus den Buchungsdaten ableiten (Bezahlt / Offen / Überfällig). */
function paymentInfo(inv: CustomerInvoice): { label: string; tone: InvoiceStatusTone } {
  if (inv.isOpen === false) {
    return { label: inv.paymentStatusName || "Bezahlt", tone: "paid" };
  }
  if (inv.isOpen === true) {
    const due = inv.dueDate ? inv.dueDate.slice(0, 10) : null;
    const today = new Date().toISOString().slice(0, 10);
    const overdue = due != null && due < today;
    return {
      label: inv.paymentStatusName || (overdue ? "Überfällig" : "Offen"),
      tone: overdue ? "overdue" : "open",
    };
  }
  // Keine Buchungsdaten: auf den Dokumentstatus zurückfallen.
  return { label: inv.statusName ?? "—", tone: statusToTone(inv.statusName) };
}

function toRow(inv: CustomerInvoice): ReceiptRow {
  const pay = paymentInfo(inv);
  return {
    id: inv.id,
    number: inv.number,
    dateStr: inv.date ? dateFormatter.format(new Date(inv.date)) : "—",
    dueStr: inv.dueDate ? dateFormatter.format(new Date(inv.dueDate)) : "—",
    party: inv.customerName ?? "—",
    projects: inv.project ? [{ id: inv.project.id, name: inv.project.name, relativeId: null }] : [],
    net: inv.net,
    tax: inv.tax,
    gross: inv.gross,
    statusLabel: pay.label,
    statusTone: pay.tone,
    file: inv.fileUpload?.src
      ? {
          filename: inv.fileUpload.filename,
          docUrl: getDocumentUrl(inv.fileUpload.src),
          thumb256: null,
          thumb512: null,
          mime: inv.fileUpload.type,
        }
      : null,
  };
}

export default async function MonthlyInvoices({
  title,
  basePath,
  year,
  month,
  view,
}: {
  title: string;
  basePath: string;
  year: number;
  month: number;
  view: InvoicesView;
}) {
  let monthly: CustomerInvoice[][] | null = null;
  let error: string | null = null;
  try {
    monthly = await getInvoicesByMonth(year);
  } catch (e) {
    error = e instanceof Error ? e.message : "Unbekannter Fehler beim Laden der Daten.";
  }

  const counts = monthly?.map((m) => m.length);
  const allInvoices = monthly ? monthly.flat() : [];
  const invoices = view === "all" ? allInvoices : monthly ? monthly[month - 1] : [];
  const heading = view === "all" ? `Alle Rechnungen ${year}` : `${MONTH_LABELS[month - 1]} ${year}`;
  const summary = summarizeInvoices(invoices);
  const rows = invoices.map(toRow);

  // Offene (noch nicht bezahlte) Rechnungen der aktuellen Ansicht – Brutto.
  const openInvoices = invoices.filter((inv) => inv.isOpen === true);
  const openTotal = openInvoices.reduce((s, inv) => s + inv.gross, 0);
  const openCount = openInvoices.length;
  const periodLabel = view === "all" ? String(year) : `${MONTH_LABELS[month - 1]} ${year}`;

  const viewHref = (v: InvoicesView) => {
    const params = new URLSearchParams({ view: v, year: String(year) });
    if (v === "month") params.set("month", String(month));
    return `${basePath}?${params.toString()}`;
  };

  return (
    <div className="flex w-full max-w-none flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
        <YearSelector year={year} basePath={basePath} extraParams={{ view, month: String(month) }} />
      </header>

      <div className="flex flex-wrap gap-1.5">
        {VIEW_OPTIONS.map((opt) => {
          const active = opt.value === view;
          return (
            <Link
              key={opt.value}
              href={viewHref(opt.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-brand-red text-white shadow-[0_0_20px_-6px_rgba(232,57,42,0.8)]"
                  : "border border-gray-300 text-gray-600 hover:border-brand-red/50 hover:text-gray-900"
              }`}
            >
              {opt.label}
            </Link>
          );
        })}
      </div>

      {view === "month" && (
        <MonthTabs year={year} month={month} basePath={basePath} counts={counts} view={view} />
      )}

      {error && (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          Fehler beim Laden der Daten von HERO: {error}
        </div>
      )}

      {monthly && <InvoicesSummaryPanel summary={summary} />}

      {monthly && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-red/30 bg-white p-5 shadow-lg shadow-black/10">
          <div>
            <p className="text-sm text-gray-600">Offene Rechnungen {periodLabel}</p>
            <p className="text-xs text-gray-400">
              {openCount} Rechnung{openCount === 1 ? "" : "en"} noch nicht bezahlt (brutto)
            </p>
          </div>
          <p className="text-2xl font-bold tabular-nums text-brand-red">
            {currencyFormatter.format(openTotal)}
          </p>
        </div>
      )}

      {monthly && (
        <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
            <h2 className="text-lg font-medium text-gray-900">{heading}</h2>
            <p className="text-sm text-gray-600">
              {invoices.length} Rechnungen · {currencyFormatter.format(summary.grossTotal)}
            </p>
          </div>

          {invoices.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-500">
              {view === "all"
                ? "Keine Rechnungen in diesem Jahr."
                : "Keine Rechnungen in diesem Monat."}
            </p>
          ) : (
            <ReceiptsTableClient
              rows={rows}
              partyLabel="Kunde"
              showProject
              showDue={false}
              exportName="rechnungen"
            />
          )}
        </div>
      )}
    </div>
  );
}
