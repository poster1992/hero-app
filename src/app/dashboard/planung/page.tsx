import Link from "next/link";
import { getEmployeeUtilization, mondayOf } from "@/lib/planning-data";
import UtilizationTable from "@/components/UtilizationTable";

const BASE_PATH = "/dashboard/planung";
const WEEKS = 8;

function parseOffset(value: string | undefined): number {
  const parsed = value ? parseInt(value, 10) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

const dateRange = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });

export default async function PlanungPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const offsetParam = Array.isArray(params.o) ? params.o[0] : params.o;
  const offset = parseOffset(offsetParam);

  const startMonday = addDays(mondayOf(new Date()), offset * WEEKS * 7);
  const endSunday = addDays(startMonday, WEEKS * 7 - 1);

  let data: Awaited<ReturnType<typeof getEmployeeUtilization>> | null = null;
  let error: string | null = null;
  try {
    data = await getEmployeeUtilization(startMonday, WEEKS);
  } catch (e) {
    error = e instanceof Error ? e.message : "Unbekannter Fehler beim Laden der Daten.";
  }

  const navBtn =
    "rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900";

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Auslastung</h1>
          <p className="mt-1 text-sm text-gray-600">
            Geplante Stunden je Mitarbeiter ·{" "}
            {dateRange.format(startMonday)}–{dateRange.format(endSunday)}.
            {startMonday.getUTCFullYear() === endSunday.getUTCFullYear()
              ? ` ${startMonday.getUTCFullYear()}`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`${BASE_PATH}?o=${offset - 1}`} className={navBtn}>
            ← Früher
          </Link>
          {offset !== 0 && (
            <Link href={BASE_PATH} className={navBtn}>
              Heute
            </Link>
          )}
          <Link href={`${BASE_PATH}?o=${offset + 1}`} className={navBtn}>
            Später →
          </Link>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          Fehler beim Laden der Daten von HERO: {error}
        </div>
      )}

      {data && <UtilizationTable data={data} />}
    </div>
  );
}
