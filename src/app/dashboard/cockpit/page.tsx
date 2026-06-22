import { getDashboardData } from "@/lib/dashboard-data";
import {
  getProjectPipeline,
  getOfferConfirmationVolume,
  getOfferConfirmationByMonth,
  getProjectLocations,
} from "@/lib/hero-api";
import OfferOrderPanel from "@/components/OfferOrderPanel";
import OpenItemsPanel from "@/components/OpenItemsPanel";
import ChecklistOverview from "@/components/ChecklistOverview";
import InvoicedRatePanel from "@/components/InvoicedRatePanel";
import StockOutPanel from "@/components/StockOutPanel";
import { getStockOutboundReport } from "@/lib/materials";
import { listOpenChecklistByMonth } from "@/lib/belege-checklist";
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

  let monthlyVolume: Awaited<ReturnType<typeof getOfferConfirmationByMonth>> | null = null;
  try {
    monthlyVolume = await getOfferConfirmationByMonth(year);
  } catch {
    // Monatsquote ist optional.
  }

  let locations: Awaited<ReturnType<typeof getProjectLocations>> = [];
  try {
    locations = await getProjectLocations();
  } catch {
    // Karte ist optional – Fehler hier blockiert das Dashboard nicht.
  }

  // Offene Punkte der monatlichen Beleg-Checkliste (bis einschließlich aktuellem Monat).
  const nowForChecklist = new Date();
  const uptoMonth =
    year < nowForChecklist.getUTCFullYear()
      ? 12
      : year > nowForChecklist.getUTCFullYear()
        ? 0
        : nowForChecklist.getUTCMonth() + 1;
  let checklistMonths: Awaited<ReturnType<typeof listOpenChecklistByMonth>> = [];
  try {
    checklistMonths = await listOpenChecklistByMonth(year, uptoMonth);
  } catch {
    // Checkliste ist optional – Fehler hier blockiert das Dashboard nicht.
  }

  let stockOut: Awaited<ReturnType<typeof getStockOutboundReport>> | null = null;
  try {
    stockOut = await getStockOutboundReport();
  } catch {
    // Lagerausgang ist optional – Fehler hier blockiert das Dashboard nicht.
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
          {(() => {
            const income = data.totalIncome;
            const output = data.totalOutput;
            const saldo = income - output;
            const max = Math.max(income, output, Math.abs(saldo), 1);
            const pct = (v: number) => `${(Math.abs(v) / max) * 100}%`;
            const marginPct = income > 0 ? (saldo / income) * 100 : 0;
            return (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* Diagramm: Umsatz / Belege / Saldo */}
                <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
                  <h2 className="mb-4 text-lg font-medium text-gray-900">Übersicht {data.year}</h2>
                  <div className="flex flex-col gap-4">
                    {[
                      { label: "Ausgangsrechnungen", value: income, color: "bg-brand-red" },
                      { label: "Belege", value: output, color: "bg-neutral-400" },
                      {
                        label: "Saldo",
                        value: saldo,
                        color: saldo < 0 ? "bg-rose-600" : "bg-brand-red-dark",
                      },
                    ].map((row) => (
                      <div key={row.label}>
                        <div className="mb-1 flex items-center justify-between text-sm">
                          <span className="text-gray-600">{row.label}</span>
                          <span className="font-medium tabular-nums text-gray-900">
                            {currencyFormatter.format(row.value)}
                          </span>
                        </div>
                        <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
                          <div
                            className={`h-full rounded-full ${row.color}`}
                            style={{ width: pct(row.value) }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex items-baseline justify-between border-t border-gray-200 pt-3 text-sm">
                    <span className="text-gray-600">Gewinn in % vom Umsatz</span>
                    <span
                      className={`text-lg font-bold tabular-nums ${
                        marginPct < 0 ? "text-rose-600" : "text-brand-red"
                      }`}
                    >
                      {marginPct.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %
                    </span>
                  </div>

                  {/* Offene (unbezahlte) Posten – brutto, Klick öffnet Monatsdetails */}
                  <OpenItemsPanel
                    year={data.year}
                    openReceiptsTotal={data.openReceiptsTotal}
                    openReceiptsCount={data.openReceiptsCount}
                    openReceiptsMonthly={data.openReceiptsMonthly}
                    openReceiptsDetails={data.openReceiptsDetails}
                    openInvoicesTotal={data.openInvoicesTotal}
                    openInvoicesCount={data.openInvoicesCount}
                    openInvoicesMonthly={data.openInvoicesMonthly}
                    openInvoicesDetails={data.openInvoicesDetails}
                  />
                </div>

                {/* Angebote & Aufträge (Klick öffnet Monatsdetails) */}
                {volume && (
                  <OfferOrderPanel
                    year={data.year}
                    offers={volume.offers}
                    confirmations={volume.confirmations}
                    monthlyOffers={monthlyVolume?.offers ?? null}
                    monthlyConfirmations={monthlyVolume?.confirmations ?? null}
                  />
                )}
              </div>
            );
          })()}

          {volume && (
            <InvoicedRatePanel
              year={data.year}
              confirmations={volume.confirmations}
              invoiced={volume.invoiced}
            />
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

          {stockOut && <StockOutPanel report={stockOut} />}

          <ChecklistOverview year={data.year} months={checklistMonths} />

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
