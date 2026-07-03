import MonthlyReceipts, { type ReceiptsView } from "@/components/MonthlyReceipts";
import ManualBelege from "@/components/ManualBelege";
import BelegeChecklist from "@/components/BelegeChecklist";
import { listManualReceipts } from "@/lib/manual-receipts";
import { listReceiptReviews } from "@/lib/receipt-reviews";
import { getPaymentOverrideMap } from "@/lib/receipt-payment-status";
import { getReceiptOcrMap, searchOcrHeroIds } from "@/lib/receipt-ocr";
import { getOcrStatus } from "@/app/dashboard/belege/ocr-index";
import { listChecklist } from "@/lib/belege-checklist";
import { MONTH_LABELS } from "@/lib/invoices";
import { listUsers, getUserByUsername } from "@/lib/users";
import { getAllowedModules } from "@/lib/role-store";
import { getSession } from "@/lib/session";

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
    const session = await getSession();
    const me = session ? await getUserByUsername(session.username) : null;
    if (me) {
      const mods = await getAllowedModules(me.role);
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

  // Checkliste nur für die eingeschränkte Ansicht direkt laden.
  let checklist: Awaited<ReturnType<typeof listChecklist>> = [];
  if (restricted) {
    try {
      checklist = await listChecklist(year, month);
    } catch {
      // optional – ohne Checkliste bleibt der Bereich leer.
    }
  }

  const monthLabel = `${MONTH_LABELS[month - 1]} ${year}`;

  return (
    <>
      {restricted && (
        <div className="w-full max-w-none px-6 pt-8">
          <BelegeChecklist items={checklist} year={year} month={month} periodLabel={monthLabel} />
        </div>
      )}
      <MonthlyReceipts
        title="Belege"
        type="output"
        basePath={BASE_PATH}
        year={year}
        month={month}
        view={view}
        partyLabel="Lieferant"
        manual={manual}
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
      {!restricted && <ManualBelege year={year} month={month} view={view} />}
    </>
  );
}
