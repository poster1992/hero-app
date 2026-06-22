import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getEmployeeProfit } from "@/lib/employee-profit";
import YearSelector from "@/components/YearSelector";
import EmployeeProfitTable from "@/components/EmployeeProfitTable";

const currencyFormatter = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

function parseYear(value: string | undefined): number {
  const currentYear = new Date().getUTCFullYear();
  const parsed = value ? parseInt(value, 10) : currentYear;
  return Number.isFinite(parsed) ? parsed : currentYear;
}

export default async function MitarbeiterbewertungPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  const yearParam = Array.isArray(params.year) ? params.year[0] : params.year;
  const year = parseYear(yearParam);

  let data: Awaited<ReturnType<typeof getEmployeeProfit>> | null = null;
  let error: string | null = null;
  try {
    data = await getEmployeeProfit(year);
  } catch (e) {
    error = e instanceof Error ? e.message : "Daten konnten nicht geladen werden.";
  }

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-6 px-4 py-8">
      <header className="relative flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Mitarbeiterbewertung</h1>
          <p className="mt-1 text-sm text-gray-600">
            Bewertung am Gewinn der {year} abgeschlossenen Projekte (inkl. Projekte in
            Nachkalkulation): Projektgewinn (Ist-Ertrag aus der Projektliste) anteilig nach
            geleisteten Stunden je Mitarbeiter.
          </p>
        </div>
        <YearSelector year={year} basePath="/dashboard/mitarbeiterbewertung" />
      </header>

      {error && (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          Fehler beim Laden der Daten von HERO: {error}
        </div>
      )}

      {data && (
        <div className="overflow-x-auto rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
            <h2 className="text-lg font-medium text-gray-900">
              Rangliste nach Gewinn · {year} abgeschlossen
            </h2>
            <p className="text-sm text-gray-600">
              Zugeordnet: {currencyFormatter.format(data.allocatedProfit)}
              {data.unallocatedProfit !== 0 && (
                <> · ohne Stundenzuordnung: {currencyFormatter.format(data.unallocatedProfit)}</>
              )}
            </p>
          </div>

          {data.rows.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-500">
              Keine Daten – keine {year} abgeschlossenen Projekte mit erfassten Stunden.
            </p>
          ) : (
            <EmployeeProfitTable rows={data.rows} />
          )}
        </div>
      )}

      <p className="text-xs text-gray-400">
        Hinweis: Ist-Ertrag = Rechnungen − Ist-Material − Ist-Lohn (Ist-Stunden × kalkulierter
        Stundensatz). Der Projektgewinn wird nach dem Stundenanteil verteilt. Projekte ohne
        erfasste Stunden lassen sich keinem Mitarbeiter zuordnen.
      </p>
    </div>
  );
}
