import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getAllowedModules } from "@/lib/role-store";
import { listVehicles, type Vehicle } from "@/lib/vehicles";
import VehicleLeasingTable from "@/components/VehicleLeasingTable";

export default async function FahrzeugLeasingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const user = await getUserByUsername(session.username);
  if (!user) redirect("/login");
  const allowed = await getAllowedModules(user.role);
  if (!allowed.includes("cockpit_fahrzeug_leasing")) redirect("/dashboard");

  let vehicles: Vehicle[] = [];
  let error: string | null = null;
  try {
    vehicles = await listVehicles();
  } catch (e) {
    error = e instanceof Error ? e.message : "Daten konnten nicht geladen werden.";
  }

  // Nur Fahrzeuge mit hinterlegter Leasingrate sind hier relevant.
  const leasedVehicles = vehicles.filter((v) => v.leasingRate != null);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-6 px-4 py-8">
      <header className="border-b-2 border-brand-red pb-2.5">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Fahrzeug Leasing</h1>
        <p className="mt-1 text-sm text-gray-600">
          Übersicht der aktuell geleasten Fahrzeuge. Rate und Restrate selbst werden unter „Fahrzeuge&quot; je
          Fahrzeug eingetragen. Sobald das Fälligkeitsdatum der Restrate erreicht ist, wird das Fahrzeug hier
          automatisch grün markiert.
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-700">{error}</div>
      ) : leasedVehicles.length === 0 ? (
        <p className="text-sm text-gray-500">
          Noch keine Fahrzeuge mit hinterlegter Leasingrate. Rate unter „Fahrzeuge&quot; beim jeweiligen Fahrzeug
          eintragen.
        </p>
      ) : (
        <VehicleLeasingTable vehicles={leasedVehicles} />
      )}
    </div>
  );
}
