import { getDashboardData } from "@/lib/dashboard-data";
import { getProjectPipeline, getOfferConfirmationVolume, getProjectLocations } from "@/lib/hero-api";
import CustomerMapPanel from "@/components/CustomerMapPanel";
import MonthlyChart from "@/components/MonthlyChart";
import DashboardTitle from "@/components/DashboardTitle";
import YearSelector from "@/components/YearSelector";
import TaxLiabilityTable from "@/components/TaxLiabilityTable";
import GuvTable from "@/components/GuvTable";
import ProjectPipelines from "@/components/ProjectPipelines";

const currencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

function parseYear(value: string | undefined): number {
  const currentYear = new Date().getUTCFullYear();
  const parsed = value ? parseInt(value, 10) : currentYear;
  return Number.isFinite(parsed) ? parsed : currentYear;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const yearParam = Array.isArray(params.year) ? params.year[0] : params.year;
  const year = parseYear(yearParam);

  let data: Awaited<ReturnType<typeof getDashboardData>> | null = null;
  let error: string | null = null;
  try {
    data = await getDashboardData(year);
  } catch (e) {
    error = e instanceof Error ? e.message : "Unbekannter Fehler beim Laden der Daten.";
  }

  let projectPipeline: Awaited<ReturnType<typeof getProjectPipeline>> | null = null;
  try {
    projectPipeline = await getProjectPipeline();
  } catch {
    // Pipeline ist optional – Fehler hier blockiert das Dashboard nicht.
  }

  let volume: Awaited<ReturnType<typeof getOfferConfirmationVolume>> | null = null;
  try {
    volume = await getOfferConfirmationVolume(year);
  } catch {
    // Volumen ist optional – Fehler hier blockiert das Dashboard nicht.
  }

  let locations: Awaited<ReturnType<typeof getProjectLocations>> = [];
  try {
    locations = await getProjectLocations();
  } catch {
    // Karte ist optional – Fehler hier blockiert das Dashboard nicht.
  }

  // Monthly averages over the months that have already occurred (incl. the current
  // month); future months that have no data yet are excluded so they don't skew it.
  let avgIncome: number | undefined;
  let avgOutput: number | undefined;
  let avgOffers: number | undefined;
  let avgConfirmations: number | undefined;
  if (data) {
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonthIndex = now.getUTCMonth();
    const months = data.monthly.filter((_, i) => {
      if (year < currentYear) return true;
      if (year > currentYear) return false;
      return i <= currentMonthIndex;
    });
    if (months.length > 0) {
      const round2 = (n: number) => Math.round(n * 100) / 100;
      avgIncome = round2(months.reduce((s, m) => s + m.income, 0) / months.length);
      avgOutput = round2(months.reduce((s, m) => s + m.output, 0) / months.length);
      avgOffers = round2(months.reduce((s, m) => s + m.offers, 0) / months.length);
      avgConfirmations = round2(
        months.reduce((s, m) => s + m.confirmations, 0) / months.length
      );
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-6 px-4 py-8">
      <header className="relative flex items-center justify-center gap-4">
        <DashboardTitle text="Cockpit" />
        <div className="absolute right-0">
          <YearSelector year={year} basePath="/dashboard/cockpit" />
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          Fehler beim Laden der Daten von HERO: {error}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="group relative overflow-hidden rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10 transition-colors hover:border-gray-400">
              <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gray-400/10 blur-2xl transition-opacity group-hover:bg-gray-400/20" />
              <div className="relative flex flex-col items-center text-center">
                <p className="text-sm text-gray-600">Ausgangsrechnungen {data.year}</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">
                  {currencyFormatter.format(data.totalIncome)}
                </p>
                <p className="mt-1 text-xs text-gray-500">{data.countIncome} Rechnungen (netto)</p>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10 transition-colors hover:border-brand-red/40">
              <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gray-400/10 blur-2xl transition-opacity group-hover:bg-gray-400/20" />
              <div className="relative flex flex-col items-center text-center">
                <p className="text-sm text-gray-600">Belege {data.year}</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">
                  {currencyFormatter.format(data.totalOutput)}
                </p>
                <p className="mt-1 text-xs text-gray-500">{data.countOutput} Belege (netto)</p>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10 transition-colors hover:border-brand-red/40">
              <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-brand-red/10 blur-2xl transition-opacity group-hover:bg-brand-red/20" />
              <div className="relative flex flex-col items-center text-center">
                <p className="text-sm text-gray-600">Saldo {data.year}</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">
                  {currencyFormatter.format(data.totalIncome - data.totalOutput)}
                </p>
                <p className="mt-1 text-xs text-gray-500">Rechnungen − Belege</p>
              </div>
            </div>
          </div>

          {volume && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-gray-300 bg-white p-5 text-center shadow-lg shadow-black/10">
                <p className="text-sm text-gray-600">Angebotsvolumen {data.year}</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">
                  {currencyFormatter.format(volume.offers)}
                </p>
                <p className="mt-1 text-xs text-gray-500">Angebote (netto)</p>
              </div>
              <div className="rounded-xl border border-gray-300 bg-white p-5 text-center shadow-lg shadow-black/10">
                <p className="text-sm text-gray-600">Auftragsbestätigungsvolumen {data.year}</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">
                  {currencyFormatter.format(volume.confirmations)}
                </p>
                <p className="mt-1 text-xs text-gray-500">Auftragsbestätigungen (netto)</p>
              </div>
              <div className="rounded-xl border border-gray-300 bg-white p-5 text-center shadow-lg shadow-black/10">
                <p className="text-sm text-gray-600">Davon verrechnet {data.year}</p>
                <p className="mt-2 text-2xl font-semibold text-emerald-600">
                  {volume.confirmations > 0
                    ? `${Math.round((volume.invoiced / volume.confirmations) * 100)} % verrechnet`
                    : "—"}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {currencyFormatter.format(volume.invoiced)} verrechnet · offen{" "}
                  {currencyFormatter.format(volume.confirmations - volume.invoiced)}
                </p>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
            <h2 className="mb-4 text-lg font-medium text-gray-900">
              Einnahmen / Ausgaben {data.year}
            </h2>
            <MonthlyChart
              data={data.monthly}
              avgIncome={avgIncome}
              avgOutput={avgOutput}
              avgOffers={avgOffers}
              avgConfirmations={avgConfirmations}
              elapsedMonths={
                year < new Date().getUTCFullYear()
                  ? 12
                  : year > new Date().getUTCFullYear()
                    ? 0
                    : new Date().getUTCMonth() + 1
              }
            />
          </div>

          {locations.length > 0 && (
            <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
              <h2 className="mb-1 text-lg font-medium text-gray-900">Einsatzorte in Luxemburg</h2>
              <p className="mb-4 text-sm text-gray-600">
                {locations.length} Projektadressen · wo wir überall arbeiten
              </p>
              <CustomerMapPanel locations={locations} />
            </div>
          )}

          {projectPipeline && (
            <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
              <h2 className="mb-4 text-lg font-medium text-gray-900">Projekt-Pipeline</h2>
              <ProjectPipelines pipeline={projectPipeline} />
            </div>
          )}

          <TaxLiabilityTable monthly={data.monthly} year={data.year} />

          <GuvTable guv={data.guv} year={data.year} />
        </>
      )}
    </div>
  );
}
