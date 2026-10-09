import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getAllowedModules } from "@/lib/role-store";
import { listVehicles, listLeasingMonthStatus, type Vehicle, type VehicleLeasingMonth } from "@/lib/vehicles";
import YearSelector from "@/components/YearSelector";
import MonthTabs from "@/components/MonthTabs";
import VehicleLeasingTable from "@/components/VehicleLeasingTable";

const BASE_PATH = "/dashboard/fahrzeug-leasing";

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

export default async function FahrzeugLeasingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const user = await getUserByUsername(session.username);
  if (!user) redirect("/login");
  const allowed = await getAllowedModules(user.role);
  if (!allowed.includes("cockpit_fahrzeug_leasing")) redirect("/dashboard");

  const params = await searchParams;
  const yearParam = Array.isArray(params.year) ? params.year[0] : params.year;
  const monthParam = Array.isArray(params.month) ? params.month[0] : params.month;
  const year = parseYear(yearParam);
  const month = parseMonth(monthParam);

  let vehicles: Vehicle[] = [];
  let statusMap: Map<number, VehicleLeasingMonth> = new Map();
  let error: string | null = null;
  try {
    [vehicles, statusMap] = await Promise.all([listVehicles(), listLeasingMonthStatus(year, month)]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Daten konnten nicht geladen werden.";
  }

  // Nur Fahrzeuge mit hinterlegter Leasingrate sind hier relevant.
  const leasedVehicles = vehicles.filter((v) => v.leasingRate != null);
  const statusByVehicle = Object.fromEntries(statusMap);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-brand-red pb-2.5">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Fahrzeug Leasing</h1>
          <p className="mt-1 text-sm text-gray-600">
            Monatliche Leasingraten je Fahrzeug abhaken (bezahlt / läuft noch) und die Restrate nach Laufzeitende
            verwalten. Die monatliche Rate selbst wird unter „Fahrzeuge&quot; je Fahrzeug eingetragen.
          </p>
        </div>
        <YearSelector year={year} basePath={BASE_PATH} extraParams={{ month: String(month) }} />
      </header>

      <MonthTabs year={year} month={month} basePath={BASE_PATH} />

      {error ? (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-700">{error}</div>
      ) : leasedVehicles.length === 0 ? (
        <p className="text-sm text-gray-500">
          Noch keine Fahrzeuge mit hinterlegter Leasingrate. Rate unter „Fahrzeuge&quot; beim jeweiligen Fahrzeug
          eintragen.
        </p>
      ) : (
        <VehicleLeasingTable vehicles={leasedVehicles} statusByVehicle={statusByVehicle} year={year} month={month} />
      )}
    </div>
  );
}
