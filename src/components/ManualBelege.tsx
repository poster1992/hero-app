import Link from "next/link";
import { listManualReceipts, searchManualOcrIds } from "@/lib/manual-receipts";
import { listChecklist } from "@/lib/belege-checklist";
import { getBookAccounts, getProjects } from "@/lib/hero-api";
import ManualBelegeForm from "@/components/ManualBelegeForm";
import ManualBelegeTable from "@/components/ManualBelegeTable";
import BelegeChecklist from "@/components/BelegeChecklist";
import { receiptDupKey } from "@/lib/receipt-duplicates";

const MONTH_LABELS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

export default async function ManualBelege({
  year,
  month,
  view,
  duplicateKeys,
  q = "",
}: {
  year: number;
  month: number;
  view: string;
  /** Dubletten-Schlüssel (Lieferant+Betrag+Datum) über HERO + manuelle Belege. */
  duplicateKeys?: Set<string>;
  /** Suchbegriff (Volltextsuche über die manuellen Belege). */
  q?: string;
}) {
  let receipts: Awaited<ReturnType<typeof listManualReceipts>> = [];
  let accounts: Awaited<ReturnType<typeof getBookAccounts>> = [];
  let checklist: Awaited<ReturnType<typeof listChecklist>> = [];
  let projects: Awaited<ReturnType<typeof getProjects>> = [];
  let error: string | null = null;
  try {
    [receipts, accounts, checklist, projects] = await Promise.all([
      listManualReceipts(year),
      getBookAccounts(),
      listChecklist(year, month),
      getProjects().catch(() => []),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Manuelle Belege konnten nicht geladen werden.";
  }

  // Bei aktiver Suche: zusätzlich die per OCR-Volltext passenden Beleg-IDs.
  const qTrim = q.trim();
  const ocrMatchIds = qTrim ? await searchManualOcrIds(qTrim).catch(() => new Set<number>()) : new Set<number>();

  // Suche: durchsucht die manuellen Belege (Lieferant, Beschreibung, Belegnr.,
  // Konto, Projekt, Datum, Betrag) – über das ganze Jahr, unabhängig vom Monat.
  const ql = q.trim().toLowerCase();
  const searchActive = ql.length > 0;
  const matchesQ = (r: (typeof receipts)[number]): boolean => {
    const hay = [
      r.supplier,
      r.description,
      r.invoiceNumber,
      r.accountNumber,
      r.accountName,
      r.projectName,
      r.projectRelativeId != null ? `#${r.projectRelativeId}` : "",
      r.date,
      String(r.gross).replace(".", ","),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    // Treffer über die strukturierten Felder ODER den OCR-Volltext des Belegs.
    return hay.includes(ql) || ocrMatchIds.has(r.id);
  };

  // Ansicht wie bei den HERO-Belegen oben (Monatlich/Alle/Offen/Fällig): dieselben
  // View-Reiter steuern die manuellen Belege. Offen/Fällig = nicht bezahlte Belege;
  // „Ungeprüft" betrifft nur HERO-Belege → hier leer. Bei aktiver Suche gilt der
  // Suchfilter über das ganze Jahr.
  const filtered = searchActive
    ? receipts.filter(matchesQ)
    : view === "all"
      ? receipts
      : view === "open" || view === "due"
        ? receipts.filter((r) => !r.isPaid)
        : view === "unreviewed"
          ? []
          : receipts.filter((r) => r.date && Number(r.date.slice(5, 7)) === month);
  const periodLabel = searchActive
    ? `Suche „${q}" (${filtered.length})`
    : view === "open"
      ? `offen ${year}`
      : view === "due"
        ? `fällig ${year}`
        : view === "all"
          ? String(year)
          : `${MONTH_LABELS[month - 1]} ${year}`;
  const monthLabel = `${MONTH_LABELS[month - 1]} ${year}`;

  // Dubletten-Flag je Beleg vorberechnen.
  const rows = filtered.map((r) => {
    const dk = receiptDupKey(r.supplier, r.gross, r.date);
    return { ...r, duplicate: dk != null && (duplicateKeys?.has(dk) ?? false) };
  });

  return (
    <div className="flex w-full max-w-none flex-col gap-6 px-6 pb-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Manuelle Belege</h1>
          <p className="mt-1 text-sm text-gray-600">
            Dokumente unabhängig von HERO hochladen und einem Konto zubuchen.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BelegeChecklist items={checklist} year={year} month={month} periodLabel={monthLabel} />
          <Link
            href="/dashboard/belege/posteingang"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
          >
            📥 Posteingang (Sammel-Upload)
          </Link>
          <ManualBelegeForm accounts={accounts} projects={projects} />
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      <ManualBelegeTable rows={rows} accounts={accounts} projects={projects} periodLabel={periodLabel} />
    </div>
  );
}
