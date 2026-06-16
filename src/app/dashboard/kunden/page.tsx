import { getCustomers } from "@/lib/hero-api";
import CustomersTable from "@/components/CustomersTable";

export default async function KundenPage() {
  let customers: Awaited<ReturnType<typeof getCustomers>> | null = null;
  let error: string | null = null;
  try {
    customers = await getCustomers();
  } catch (e) {
    error = e instanceof Error ? e.message : "Unbekannter Fehler beim Laden der Daten.";
  }

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Kunden</h1>
      </header>

      {error && (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          Fehler beim Laden der Daten von HERO: {error}
        </div>
      )}

      {customers && <CustomersTable customers={customers} />}
    </div>
  );
}
