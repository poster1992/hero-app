import YearSelector from "@/components/YearSelector";
import MonthTabs from "@/components/MonthTabs";
import { getTrackingTimes } from "@/lib/hero-api";
import { MONTH_LABELS } from "@/lib/invoices";
import WorkingHoursTable from "@/components/WorkingHoursTable";

const BASE_PATH = "/dashboard/arbeitszeiten";

const hoursFormatter = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

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

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export default async function ArbeitszeitenPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const yearParam = Array.isArray(params.year) ? params.year[0] : params.year;
  const monthParam = Array.isArray(params.month) ? params.month[0] : params.month;
  const year = parseYear(yearParam);
  const month = parseMonth(monthParam);

  const start = `${year}-${pad(month)}-01`;
  const end = month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`;

  let entries: Awaited<ReturnType<typeof getTrackingTimes>> | null = null;
  let error: string | null = null;
  try {
    entries = await getTrackingTimes(start, end);
  } catch (e) {
    error = e instanceof Error ? e.message : "Unbekannter Fehler beim Laden der Daten.";
  }

  const byEmployee = new Map<string, number>();
  let totalHours = 0;
  for (const e of entries ?? []) {
    byEmployee.set(e.partnerName, (byEmployee.get(e.partnerName) ?? 0) + e.durationHours);
    totalHours += e.durationHours;
  }
  const rows = [...byEmployee.entries()]
    .map(([name, hours]) => ({ name, hours: Math.round(hours * 100) / 100 }))
    .sort((a, b) => b.hours - a.hours);

  return (
    <div className="flex w-full max-w-none flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-gray-900">Arbeitszeiten</h1>
        <YearSelector year={year} basePath={BASE_PATH} extraParams={{ month: String(month) }} />
      </header>

      <MonthTabs year={year} month={month} basePath={BASE_PATH} />

      {error && (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          Fehler beim Laden der Daten von HERO: {error}
        </div>
      )}

      {entries && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
              <p className="text-sm text-gray-600">Gesamtstunden</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">
                {hoursFormatter.format(totalHours)} h
              </p>
            </div>
            <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
              <p className="text-sm text-gray-600">Mitarbeiter</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{rows.length}</p>
            </div>
            <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
              <p className="text-sm text-gray-600">Einträge</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{entries.length}</p>
            </div>
          </div>

          <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
              <h2 className="text-lg font-medium text-gray-900">
                Stunden je Mitarbeiter · {MONTH_LABELS[month - 1]} {year}
              </h2>
              <p className="text-sm text-gray-600">{hoursFormatter.format(totalHours)} h gesamt</p>
            </div>

            <WorkingHoursTable entries={entries} />
          </div>
        </>
      )}
    </div>
  );
}
