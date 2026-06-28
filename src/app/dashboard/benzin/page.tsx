import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getFuelAnalysis, getFuelStatus, type FuelAnalysis, type FuelStatus } from "@/app/dashboard/benzin/actions";
import FuelDashboard from "@/components/FuelDashboard";

export default async function BenzinPage() {
  if (!(await getSession())) redirect("/login");

  let analysis: FuelAnalysis = {
    invoiceCount: 0,
    totalLiters: 0,
    totalNet: 0,
    totalGross: 0,
    vehicles: [],
    months: [],
    vehicleNames: [],
    monthlyByVehicleNet: [],
    monthlyByVehicleLiters: [],
  };
  let status: FuelStatus = { total: 0, done: 0 };
  let error: string | null = null;
  try {
    [analysis, status] = await Promise.all([getFuelAnalysis(), getFuelStatus()]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Daten konnten nicht geladen werden.";
  }

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Benzin / Tankkosten</h1>
        <p className="mt-1 text-sm text-gray-600">
          Auswertung der Circle-K-Tankrechnungen – nach Fahrzeug und Monat.
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : (
        <FuelDashboard analysis={analysis} status={status} />
      )}
    </div>
  );
}
