import Link from "next/link";
import { listManualReceipts, listAllManualReceipts, searchManualOcrIds } from "@/lib/manual-receipts";
import { listChecklist } from "@/lib/belege-checklist";
import { getBookAccounts, getProjects, getSupplierContacts } from "@/lib/hero-api";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getHiddenBelegColumns } from "@/lib/belege-column-prefs";
import ManualBelegeForm from "@/components/ManualBelegeForm";
import ManualBelegeTable from "@/components/ManualBelegeTable";
import BelegeChecklist from "@/components/BelegeChecklist";
import PaymentAdvices, { PaymentAdviceButton } from "@/components/PaymentAdvices";
import type { HeroBelegRow } from "@/components/ManualBelegeTable";
import { listPaymentAdvices } from "@/lib/payment-advices";
import { receiptDupKey } from "@/lib/receipt-duplicates";
import { getCustomerName, getDocumentUrl, effectiveReceiptStatus } from "@/lib/invoices";
import type { Receipt } from "@/lib/hero-api";

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
  receiptsByMonth = null,
  paymentOverrides,
  searchIds = null,
}: {
  year: number;
  month: number;
  view: string;
  /** Dubletten-Schlüssel (Lieferant+Betrag+Datum) über HERO + manuelle Belege. */
  duplicateKeys?: Set<string>;
  /** Suchbegriff (Volltextsuche über die manuellen Belege). */
  q?: string;
  /** HERO-Belege des Jahres (nach Monat) – für die gemeinsame Liste. */
  receiptsByMonth?: Receipt[][] | null;
  /** Lokale Zahlstatus-Overrides je HERO-Beleg-ID. */
  paymentOverrides?: ReadonlyMap<string, { status: "bezahlt" | "offen" }>;
  /** HERO-Beleg-IDs, die zur Volltextsuche passen (nur bei aktiver Suche). */
  searchIds?: Set<string> | null;
}) {
  let receipts: Awaited<ReturnType<typeof listManualReceipts>> = [];
  let accounts: Awaited<ReturnType<typeof getBookAccounts>> = [];
  let checklist: Awaited<ReturnType<typeof listChecklist>> = [];
  let projects: Awaited<ReturnType<typeof getProjects>> = [];
  let suppliers: Awaited<ReturnType<typeof getSupplierContacts>> = [];
  let error: string | null = null;
  try {
    [receipts, accounts, checklist, projects, suppliers] = await Promise.all([
      // Bei aktiver Suche jahresübergreifend laden (sonst nur das gewählte Jahr) –
      // sonst würden Belege aus anderen Jahren gar nicht durchsucht.
      q.trim() ? listAllManualReceipts() : listManualReceipts(year),
      getBookAccounts(),
      listChecklist(year, month),
      getProjects().catch(() => []),
      getSupplierContacts().catch(() => []),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Manuelle Belege konnten nicht geladen werden.";
  }

  // Zahlungsavise des Monats (reine Speicherung + Export mit den Belegen).
  let advices: Awaited<ReturnType<typeof listPaymentAdvices>> = [];
  try {
    advices = await listPaymentAdvices(year, month);
  } catch {
    // Optional – ohne Avise bleibt der Bereich einfach leer.
  }

  // Pro-User ausgeblendete Spalten laden (individuelle Tabellen-Konfiguration).
  let hiddenColumns: string[] = [];
  try {
    const session = await getSession();
    const user = session ? await getUserByUsername(session.username) : null;
    if (user) hiddenColumns = await getHiddenBelegColumns(user.id);
  } catch {
    // Ohne Konfiguration sind einfach alle Spalten sichtbar.
  }

  // Bei aktiver Suche: zusätzlich die per OCR-Volltext passenden Beleg-IDs.
  const qTrim = q.trim();
  const ocrMatchIds = qTrim ? await searchManualOcrIds(qTrim).catch(() => new Set<number>()) : new Set<number>();

  // Suche: durchsucht die manuellen Belege (Lieferant, Beschreibung, Belegnr.,
  // Konto, Projekt, Datum, Betrag) – über das ganze Jahr, unabhängig vom Monat.
  const ql = q.trim().toLowerCase();
  const searchActive = ql.length > 0;
  // Wortweise Suche (UND): jedes Wort muss in den strukturierten Feldern vorkommen –
  // egal in welcher Reihenfolge. So findet „mosel 520" auch „Mosel Baustoff … 520,65".
  const qWords = ql.split(/\s+/).filter(Boolean);
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
    // Treffer, wenn ALLE Wörter in den Feldern stehen ODER der OCR-Volltext passt
    // (searchManualOcrIds prüft ebenfalls wortweise über den Belegtext).
    return qWords.every((w) => hay.includes(w)) || ocrMatchIds.has(r.id);
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

  // HERO-Belege für dieselbe Ansicht/Suche aufbereiten (gekennzeichnete Zeilen in der Liste).
  const heroAll = receiptsByMonth ? receiptsByMonth.flat() : [];
  const now = new Date();
  const heroView: Receipt[] = searchActive
    ? searchIds
      ? heroAll.filter((r) => searchIds.has(r.id))
      : []
    : view === "all"
      ? heroAll
      : view === "open"
        ? heroAll.filter((r) => r.openAmount > 0.005)
        : view === "due"
          ? heroAll.filter((r) => r.openAmount > 0.005 && r.dueDate && new Date(r.dueDate) <= now)
          : view === "unreviewed"
            ? []
            : receiptsByMonth?.[month - 1] ?? [];
  const heroRows: HeroBelegRow[] = heroView.map((r) => {
    const ov = paymentOverrides?.get(r.id)?.status ?? null;
    const st = effectiveReceiptStatus(r, ov);
    const supplier = getCustomerName(r);
    const dateIso = r.receiptDate ? r.receiptDate.slice(0, 10) : null;
    const dk = receiptDupKey(supplier, r.value, dateIso);
    return {
      id: r.id,
      number: r.number,
      date: dateIso,
      supplier,
      net: r.netValue,
      vat: Math.round((r.value - r.netValue) * 100) / 100,
      gross: r.value,
      statusLabel: st.label,
      isPaid: st.tone === "paid",
      docUrl: r.fileUpload?.src ? getDocumentUrl(r.fileUpload.src) : null,
      duplicate: dk != null && (duplicateKeys?.has(dk) ?? false),
    };
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
          <PaymentAdviceButton year={year} month={month} monthLabel={monthLabel} />
          <Link
            href="/dashboard/belege/posteingang"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
          >
            📥 Posteingang (Sammel-Upload)
          </Link>
          <ManualBelegeForm accounts={accounts} projects={projects} suppliers={suppliers} />
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      <ManualBelegeTable
        rows={rows}
        accounts={accounts}
        projects={projects}
        suppliers={suppliers}
        periodLabel={periodLabel}
        hiddenColumns={hiddenColumns}
        paymentAdvices={advices.map((a) => ({ id: a.id, filename: a.fileName }))}
        heroRows={heroRows}
      />

      <PaymentAdvices monthLabel={monthLabel} advices={advices} />
    </div>
  );
}
