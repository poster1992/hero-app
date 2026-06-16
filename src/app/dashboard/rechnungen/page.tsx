import MonthlyInvoices, { type InvoicesView } from "@/components/MonthlyInvoices";

const BASE_PATH = "/dashboard/rechnungen";

function parseView(value: string | undefined): InvoicesView {
  return value === "all" ? "all" : "month";
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

export default async function RechnungenPage({
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

  return (
    <MonthlyInvoices title="Rechnungen" basePath={BASE_PATH} year={year} month={month} view={view} />
  );
}
