import Link from "next/link";
import YearSelector from "@/components/YearSelector";
import MonthTabs from "@/components/MonthTabs";
import ReceiptsSummaryPanel from "@/components/ReceiptsSummaryPanel";
import ReceiptsTable from "@/components/ReceiptsTable";
import { getReceiptsByMonth, summarizeReceipts, mergeManualIntoSummary, MONTH_LABELS } from "@/lib/invoices";
import type { ReceiptType } from "@/lib/hero-api";
import type { ManualReceipt } from "@/lib/manual-receipts";
import type { ReceiptReview } from "@/lib/receipt-reviews";
import type { PaymentOverride } from "@/lib/receipt-payment-status";
import type { ReceiptOcrFields } from "@/lib/receipt-ocr";
import type { OcrStatus } from "@/app/dashboard/belege/ocr-index";
import OcrIndexPanel from "@/components/OcrIndexPanel";
import type { DuplicateGroup } from "@/lib/receipt-duplicates";
import DuplicateWarning from "@/components/DuplicateWarning";

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
  paymentOverrides,
  ocrMap,
  ocrStatus,
  searchIds,
  q = "",
  restricted = false,
  receiptsByMonth = null,
  duplicateKeys,
  duplicateGroups = [],
}: {
  title: string;
  type: ReceiptType;
  basePath: string;
  year: number;
  month: number;
  view: ReceiptsView;
  partyLabel?: string;
  /** Vorgeladene HERO-Belege (spart den erneuten Abruf). */
  receiptsByMonth?: Awaited<ReturnType<typeof getReceiptsByMonth>> | null;
  /** Dubletten-Schlüssel (Lieferant+Betrag+Datum) zum Markieren der Zeilen. */
  duplicateKeys?: Set<string>;
  /** Dubletten-Gruppen für den Warnhinweis. */
  duplicateGroups?: DuplicateGroup[];
  /** Eingeschränkte Ansicht: nur Suche + Belegliste (ohne Summen, Import-Tools, Tabs, Jahr). */
  restricted?: boolean;
  /** Manually uploaded receipts (year), folded into the summary cards. */
  manual?: ManualReceipt[];
  /** Review status per HERO receipt id (Rechnungsprüfung). */
  reviews?: Map<string, ReceiptReview>;
  reviewers?: { id: number; name: string }[];
  canReview?: boolean;
  /** Lokale Zahlstatus-Overrides je HERO-Beleg-ID (nur Belege). */
  paymentOverrides?: Map<string, PaymentOverride>;
  /** OCR-Felder je HERO-Beleg-ID (Zahlungsziel/Skonto). */
  ocrMap?: Map<string, ReceiptOcrFields>;
  /** Fortschritt der OCR-Indexierung (für den Button). */
  ocrStatus?: OcrStatus;
  /** Schlagwortsuche: passende HERO-Beleg-IDs (oder null = keine Suche aktiv). */
  searchIds?: Set<string> | null;
  /** Aktueller Suchbegriff (für das Eingabefeld). */
  q?: string;
}) {
  let monthly: Awaited<ReturnType<typeof getReceiptsByMonth>> | null = receiptsByMonth;
  let error: string | null = null;
  if (!monthly) {
    try {
      monthly = await getReceiptsByMonth(year, type);
    } catch (e) {
      error = e instanceof Error ? e.message : "Unbekannter Fehler beim Laden der Daten.";
    }
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

  // Schlagwortsuche (Volltext im Beleg-Dokument): über das GANZE Jahr (alle Monate)
  // suchen, nicht nur die aktuelle Monats-/View-Auswahl.
  if (searchIds) {
    receipts = allReceipts.filter((r) => searchIds.has(r.id));
    heading = `Suche „${q}" (${receipts.length})`;
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

  // Manuelle Belege haben keinen OCR-Volltext → bei aktiver Suche ausblenden.
  if (searchIds) manualFiltered = [];

  const summary = mergeManualIntoSummary(summarizeReceipts(receipts), manualFiltered);

  const viewHref = (v: ReceiptsView) => {
    const params = new URLSearchParams({ view: v, year: String(year) });
    if (v === "month") params.set("month", String(month));
    return `${basePath}?${params.toString()}`;
  };

  // Ab Juli 2026 werden Belege nur noch über den Posteingang (manuell) erfasst –
  // die HERO-Belege-Box wird für diese Zeiträume fortlaufend ausgeblendet.
  // (Nur Belege/„output"; für die Jahres-Ansicht 2026 bleibt sie sichtbar, da
  // Jan–Jun noch HERO-Belege enthält.)
  // Bei aktiver Suche NICHT ausblenden – sonst würden HERO-Treffer (z. B. ältere
  // Eingangsbelege) trotz Fundstelle nicht angezeigt.
  const hideHeroOutput =
    type === "output" &&
    !searchIds &&
    (year > 2026 || (year === 2026 && view === "month" && month >= 7));

  // HERO-Belege stehen jetzt (gekennzeichnet) in der gemeinsamen Liste unten.
  // Die separate HERO-Panel-Ansicht + der Juli-Hinweis werden ausgeblendet (Code
  // bleibt erhalten – bei Bedarf hier wieder auf true setzen).
  const SHOW_LEGACY_HERO_PANEL = false;

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
          {type === "output" && !restricted && (
            <>
              <Link
                href="/dashboard/belege/kontoauszug"
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
              >
                Kontoauszug einlesen
              </Link>
              <Link
                href="/dashboard/belege/ibans"
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
              >
                Lieferanten-IBANs
              </Link>
            </>
          )}
          {!restricted && (
            <YearSelector year={year} basePath={basePath} extraParams={{ view, month: String(month) }} />
          )}
        </div>
      </header>

      {!restricted && (
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
      )}

      {type === "output" && (
        <div className="flex flex-wrap items-center gap-3">
          <form action={basePath} method="get" className="flex items-center gap-2">
            <input type="hidden" name="view" value={view} />
            <input type="hidden" name="year" value={year} />
            <input type="hidden" name="month" value={month} />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="In Belegen suchen (Volltext) …"
              className="w-64 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-red focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-md bg-brand-red px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Suchen
            </button>
            {q && (
              <a
                href={`${basePath}?view=${view}&year=${year}&month=${month}`}
                className="text-sm text-gray-500 transition-colors hover:text-gray-800"
              >
                zurücksetzen
              </a>
            )}
          </form>
          {/* OCR-Indexierung betrifft nur HERO-Belege. Ab Juli 2026 kommen keine
              neuen mehr hinzu → Panel nur zeigen, wenn wirklich noch etwas zu
              indexieren ist (done < total); sonst ist es überflüssig. */}
          {ocrStatus && !restricted && ocrStatus.done < ocrStatus.total && (
            <OcrIndexPanel status={ocrStatus} />
          )}
        </div>
      )}

      {!restricted && view === "month" && !searchIds && (
        <MonthTabs year={year} month={month} basePath={basePath} counts={counts} view={view} />
      )}

      {error && (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-brand-red-dark">
          Fehler beim Laden der Daten von HERO: {error}
        </div>
      )}

      {monthly && !restricted && <ReceiptsSummaryPanel summary={summary} />}

      <DuplicateWarning groups={duplicateGroups} />

      {SHOW_LEGACY_HERO_PANEL && hideHeroOutput && (
        <div className="border border-line bg-gray-50 px-5 py-4 text-sm text-gray-600">
          Ab Juli 2026 werden Belege nur noch über den Posteingang erfasst – siehe Abschnitt
          „Manuelle Belege“ unten.
        </div>
      )}

      {SHOW_LEGACY_HERO_PANEL && monthly && !hideHeroOutput && (
        // HERO-Belege stehen jetzt (gekennzeichnet) in der gemeinsamen Liste unten.
        // Diese eingeklappte Ansicht behält die vollen HERO-Funktionen (Rechnungs-
        // prüfung, SEPA, Zahlstatus, OCR), bis sie in die gemeinsame Liste umgezogen sind.
        <details className="border border-line bg-white">
          <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-5 py-4">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
              HERO-Belege · {heading}{" "}
              <span className="text-sm font-normal text-gray-500">– Prüfung / SEPA / Zahlstatus</span>
            </span>
            <span className="text-sm text-gray-600">
              {receipts.length} Belege · {currencyFormatter.format(summary.grossTotal)}
            </span>
          </summary>
          <div className="border-t border-gray-200">
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
                enablePaidStatus={type === "output"}
                paymentOverrides={paymentOverrides}
                ocrMap={ocrMap}
                showOcr={type === "output"}
                duplicateKeys={duplicateKeys}
              />
            )}
          </div>
        </details>
      )}
    </div>
  );
}
