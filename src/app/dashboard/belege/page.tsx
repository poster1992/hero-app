import MonthlyReceipts, { type ReceiptsView } from "@/components/MonthlyReceipts";
import ManualBelege from "@/components/ManualBelege";
import { listManualReceipts } from "@/lib/manual-receipts";

const BASE_PATH = "/dashboard/belege";

function parseView(value: string | undefined): ReceiptsView {
  return value === "all" || value === "open" || value === "due" ? value : "month";
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
      />
      <ManualBelege year={year} month={month} view={view} />
    </>
  );
}
