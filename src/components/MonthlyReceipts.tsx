import Link from "next/link";
import YearSelector from "@/components/YearSelector";
import MonthTabs from "@/components/MonthTabs";
import ReceiptsSummaryPanel from "@/components/ReceiptsSummaryPanel";
import ReceiptsTable from "@/components/ReceiptsTable";
import { getReceiptsByMonth, summarizeReceipts, mergeManualIntoSummary, MONTH_LABELS } from "@/lib/invoices";
import type { ReceiptType } from "@/lib/hero-api";
import type { ManualReceipt } from "@/lib/manual-receipts";
import type { ReceiptReview } from "@/lib/receipt-reviews";

const currencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

export type ReceiptsView = "month" | "all" | "open" | "due" | "unreviewed";

const VIEW_OPTIONS: { value: ReceiptsView; label: string }[] = [
  { value: "month", label: "Monatlich" },
  { value: "all", label: "Alle" },
  { value: "open", label: "Offen" },
  { value: "due", label: "Fällig" },
];

export default async function MonthlyReceipts({
  title,
  type,
  basePath,
  year,
  month,
  view,
  partyLabel = "Kunde",
  manual = [],
  reviews,
  reviewers = [],
  canReview = false,
}: {
  title: string;
  type: ReceiptType;
  basePath: string;
  year: number;
  month: number;
  view: ReceiptsView;
  partyLabel?: string;
  /** Manually uploaded receipts (year), folded into the summary cards. */
  manual?: ManualReceipt[];
  /** Review status per HERO receipt id (Rechnungsprüfung). */
  reviews?: Map<string, ReceiptReview>;
  reviewers?: { id: number; name: string }[];
  canReview?: boolean;
}) {
  let monthly: Awaited<ReturnType<typeof getReceiptsByMonth>> | null = null;
  let error: string | null = null;
  try {
    monthly = await getReceiptsByMonth(year, type);
  } catch (e) {
    error = e instanceof Error ? e.message : "Unbekannter Fehler beim Laden der Daten.";
  }

  const counts = monthly?.map((m) => m.length);
  const allReceipts = monthly ? monthly.flat() : [];

  const now = new Date();
  let receipts: typeof allReceipts;
  let heading: string;
  if (view === "all") {
    receipts = allReceipts;
    heading = `Alle Belege ${year}`;
  } else if (view === "open") {
    receipts = allReceipts.filter((r) => r.openAmount > 0.005);
    heading = `Offene Belege ${year}`;
  } else if (view === "due") {
    receipts = allReceipts
      .filter((r) => r.openAmount > 0.005 && r.dueDate && new Date(r.dueDate) <= now)
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
    heading = `Fällige Rechnungen ${year}`;
  } else if (view === "unreviewed") {
    // Noch nicht entschieden (kein Freigegeben/Abgelehnt).
    receipts = allReceipts.filter((r) => {
      const st = reviews?.get(r.id)?.status;
      return st !== "freigegeben" && st !== "abgelehnt";
    });
    heading = `Ungeprüfte Belege ${year}`;
  } else {
    receipts = monthly ? monthly[month - 1] : [];
    heading = `${MONTH_LABELS[month - 1]} ${year}`;
  }

  // Manuelle Belege passend zur aktuellen Ansicht (Monat/Alle/Offen/Fällig).
  let manualFiltered: ManualReceipt[];
  if (view === "all") {
    manualFiltered = manual;
  } else if (view === "open" || view === "due") {
    manualFiltered = manual.filter((r) => !r.isPaid);
  } else if (view === "unreviewed") {
    manualFiltered = []; // Prüfung betrifft nur HERO-Belege.
  } else {
    manualFiltered = manual.filter((r) => r.date && Number(r.date.slice(5, 7)) === month);
  }

  const summary = mergeManualIntoSummary(summarizeReceipts(receipts), manualFiltered);

  const viewHref = (v: ReceiptsView) => {
    const params = new URLSearchParams({ view: v, year: String(year) });
    if (v === "month") params.set("month", String(month));
    return `${basePath}?${params.toString()}`;
  };

  const emptyText =
    view === "open"
      ? "Keine offenen Belege in diesem Jahr."
      : view === "due"
        ? "Keine fälligen Rechnungen in diesem Jahr."
        : view === "all"
          ? "Keine Belege in diesem Jahr."
          : "Keine Belege in diesem Monat.";

  return (
    <div className="flex w-full max-w-none flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {type === "output" && (
            <Link
              href="/dashboard/belege/ibans"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
            >
              Lieferanten-IBANs
            </Link>
          )}
          <YearSelector year={year} basePath={basePath} extraParams={{ view, month: String(month) }} />
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {(canReview
          ? [...VIEW_OPTIONS, { value: "unreviewed" as ReceiptsView, label: "Ungeprüft" }]
          : VIEW_OPTIONS
        ).map((opt) => {
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

      {monthly && <ReceiptsSummaryPanel summary={summary} />}

      {monthly && (
        <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
            <h2 className="text-lg font-medium text-gray-900">{heading}</h2>
            <p className="text-sm text-gray-600">
              {receipts.length} Belege · {currencyFormatter.format(summary.grossTotal)}
            </p>
          </div>

          {receipts.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-500">{emptyText}</p>
          ) : (
            <ReceiptsTable
              receipts={receipts}
              partyLabel={partyLabel}
              reviews={reviews}
              reviewers={reviewers}
              canReview={canReview}
              enableSepa={type === "output"}
            />
          )}
        </div>
      )}
    </div>
  );
}
