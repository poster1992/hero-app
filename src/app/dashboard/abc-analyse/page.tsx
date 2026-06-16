import YearSelector from "@/components/YearSelector";
import AbcTable from "@/components/AbcTable";
import { getCustomerRevenue, getSupplierCost, computeAbc } from "@/lib/invoices";

const BASE_PATH = "/dashboard/abc-analyse";

function parseYear(value: string | undefined): number {
  const currentYear = new Date().getUTCFullYear();
  const parsed = value ? parseInt(value, 10) : currentYear;
  return Number.isFinite(parsed) ? parsed : currentYear;
}

export default async function AbcAnalysePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const yearParam = Array.isArray(params.year) ? params.year[0] : params.year;
  const year = parseYear(yearParam);

  let customers: ReturnType<typeof computeAbc> | null = null;
  let suppliers: ReturnType<typeof computeAbc> | null = null;
  let error: string | null = null;
  try {
    const [revenue, cost] = await Promise.all([
      getCustomerRevenue(year),
      getSupplierCost(year),
    ]);
    customers = computeAbc(revenue);
    suppliers = computeAbc(cost);
  } catch (e) {
    error = e instanceof Error ? e.message : "Unbekannter Fehler beim Laden der Daten.";
  }

  return (
    <div className="flex w-full max-w-none flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">ABC-Analyse</h1>
          <p className="mt-1 text-sm text-gray-500">
            Kunden nach Umsatz, Lieferanten nach Kosten (A ≤ 80 % · B ≤ 95 % · C Rest, kumuliert)
          </p>
        </div>
        <YearSelector year={year} basePath={BASE_PATH} />
      </header>

      {error && (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          Fehler beim Laden der Daten von HERO: {error}
        </div>
      )}

      {customers && (
        <AbcTable title={`Kunden ${year}`} rows={customers} valueLabel="Umsatz (netto)" />
      )}
      {suppliers && (
        <AbcTable title={`Lieferanten ${year}`} rows={suppliers} valueLabel="Kosten (netto)" />
      )}
    </div>
  );
}
