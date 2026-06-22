import MonthlyReceipts, { type ReceiptsView } from "@/components/MonthlyReceipts";
import ManualBelege from "@/components/ManualBelege";
import { listManualReceipts } from "@/lib/manual-receipts";
import { listReceiptReviews } from "@/lib/receipt-reviews";
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

  let manual: Awaited<ReturnType<typeof listManualReceipts>> = [];
  try {
    manual = await listManualReceipts(year);
  } catch {
    // Manuelle Belege sind optional – Fehler hier blockiert die Seite nicht.
  }

  // Rechnungsprüfung: Status, Prüfer-Liste und Berechtigung.
  let reviews: Awaited<ReturnType<typeof listReceiptReviews>> = new Map();
  let reviewers: { id: number; name: string }[] = [];
  let canReview = false;
  try {
    const session = await getSession();
    const me = session ? await getUserByUsername(session.username) : null;
    if (me) canReview = (await getAllowedModules(me.role)).includes("rechnungspruefung");
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
        reviews={reviews}
        reviewers={reviewers}
        canReview={canReview}
      />
      <ManualBelege year={year} month={month} view={view} />
    </>
  );
}
