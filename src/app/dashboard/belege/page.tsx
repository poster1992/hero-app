import MonthlyReceipts, { type ReceiptsView } from "@/components/MonthlyReceipts";
import ManualBelege from "@/components/ManualBelege";
import { listManualReceipts } from "@/lib/manual-receipts";
import { getReceiptsByMonth, getCustomerName } from "@/lib/invoices";
import { computeReceiptDuplicates } from "@/lib/receipt-duplicates";
import { listReceiptReviews } from "@/lib/receipt-reviews";
import { getPaymentOverrideMap } from "@/lib/receipt-payment-status";
import { getReceiptOcrMap, searchOcrHeroIds } from "@/lib/receipt-ocr";
import { getOcrStatus } from "@/app/dashboard/belege/ocr-index";
import { listUsers } from "@/lib/users";
import { getAllowedModules } from "@/lib/role-store";
import { getEffectiveRole } from "@/lib/session";

const BASE_PATH = "/dashboard/belege";

function parseView(value: string | undefined): ReceiptsView {
  return value === "all" || value === "open" || value === "due" || value === "unreviewed"
    ? value
    : "month";
}

function parseYear(value: string | undefined): number {
  const currentYear = new Date().getUTCFullYear();
  const parsed = value ? parseInt(value, 10) : currentYear;
  return Number.isFinite(parsed) ? parsed : currentYear;
}

function parseMonth(value: string | undefined): number {
  const currentMonth = new Date().getUTCMonth() + 1;
  const parsed = value ? parseInt(value, 10) : currentMonth;
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 12) return currentMonth;
  return parsed;
}

export default async function BelegePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const yearParam = Array.isArray(params.year) ? params.year[0] : params.year;
  const monthParam = Array.isArray(params.month) ? params.month[0] : params.month;
  const viewParam = Array.isArray(params.view) ? params.view[0] : params.view;
  const year = parseYear(yearParam);
  const month = parseMonth(monthParam);
  const view = parseView(viewParam);
  const q = (Array.isArray(params.q) ? params.q[0] : params.q)?.trim() ?? "";

  // OCR: extrahierte Felder, Indexierungs-Status, Schlagwortsuche.
  let ocrMap: Awaited<ReturnType<typeof getReceiptOcrMap>> = new Map();
  let ocrStatus = { total: 0, done: 0 };
  let searchIds: Set<string> | null = null;
  try {
    [ocrMap, ocrStatus] = await Promise.all([getReceiptOcrMap(), getOcrStatus()]);
    if (q) searchIds = await searchOcrHeroIds(q);
  } catch {
    // OCR optional – ohne Index bleiben die Spalten leer.
  }

  let manual: Awaited<ReturnType<typeof listManualReceipts>> = [];
  try {
    manual = await listManualReceipts(year);
  } catch {
    // Manuelle Belege sind optional – Fehler hier blockiert die Seite nicht.
  }

  // HERO-Belege des Jahres einmal laden und an MonthlyReceipts durchreichen
  // (spart einen zweiten Abruf) + Basis für die Dubletten-Prüfung.
  let receiptsByMonth: Awaited<ReturnType<typeof getReceiptsByMonth>> | null = null;
  try {
    receiptsByMonth = await getReceiptsByMonth(year, "output");
  } catch {
    // Ohne HERO-Belege bleibt nur die manuelle Dubletten-Prüfung.
  }

  // Dubletten (Lieferant + Bruttobetrag + Datum) über HERO- UND manuelle Belege.
  const { keys: duplicateKeys, groups: duplicateGroups } = computeReceiptDuplicates([
    ...(receiptsByMonth?.flat() ?? []).map((r) => ({
      supplier: getCustomerName(r),
      gross: r.value,
      dateISO: r.receiptDate,
    })),
    ...manual.map((m) => ({ supplier: m.supplier, gross: m.gross, dateISO: m.date })),
  ]);

  // Lokale Zahlstatus-Overrides (überschreiben den HERO-Status je Beleg).
  let paymentOverrides: Awaited<ReturnType<typeof getPaymentOverrideMap>> = new Map();
  try {
    paymentOverrides = await getPaymentOverrideMap();
  } catch {
    // Optional – ohne Overrides gilt einfach der HERO-Status.
  }

  // Rechnungsprüfung + Zugriffsstufe (voll vs. eingeschränkt).
  let reviews: Awaited<ReturnType<typeof listReceiptReviews>> = new Map();
  let reviewers: { id: number; name: string }[] = [];
  let canReview = false;
  // Ohne vollen Belege-Zugriff nur die eingeschränkte Ansicht (Checkliste + Belegliste + Suche).
  let restricted = false;
  try {
    // Effektive Rolle nutzen, damit die Admin-Vorschau (preview_role) hier ebenso greift.
    const { role } = await getEffectiveRole();
    if (role) {
      const mods = await getAllowedModules(role);
      canReview = mods.includes("rechnungspruefung");
      restricted = !mods.includes("cockpit_belege");
    }
    if (canReview) {
      const [r, users] = await Promise.all([listReceiptReviews(), listUsers()]);
      reviews = r;
      reviewers = users
        .filter((u) => u.isActive)
        .map((u) => ({ id: u.id, name: u.displayName || u.username }));
    }
  } catch {
    // Prüfung ist optional – Fehler hier blockiert die Seite nicht.
  }

  return (
    <>
      <MonthlyReceipts
        title="Belege"
        type="output"
        basePath={BASE_PATH}
        year={year}
        month={month}
        view={view}
        partyLabel="Lieferant"
        manual={manual}
        receiptsByMonth={receiptsByMonth}
        duplicateKeys={duplicateKeys}
        duplicateGroups={duplicateGroups}
        reviews={reviews}
        reviewers={reviewers}
        canReview={canReview}
        paymentOverrides={paymentOverrides}
        ocrMap={ocrMap}
        ocrStatus={ocrStatus}
        searchIds={searchIds}
        q={q}
        restricted={restricted}
      />
      {!restricted && (
        <ManualBelege year={year} month={month} view={view} duplicateKeys={duplicateKeys} q={q} />
      )}
    </>
  );
}
