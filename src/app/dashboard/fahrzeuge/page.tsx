import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getAllowedModules } from "@/lib/role-store";
import { listVehicles, type Vehicle } from "@/lib/vehicles";
import VehicleDocuments from "@/components/VehicleDocuments";

export default async function FahrzeugePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const user = await getUserByUsername(session.username);
  if (!user) redirect("/login");
  const allowed = await getAllowedModules(user.role);
  if (!allowed.includes("cockpit_fahrzeuge")) redirect("/dashboard");

  let vehicles: Vehicle[] = [];
  let error: string | null = null;
  try {
    vehicles = await listVehicles();
  } catch (e) {
    error = e instanceof Error ? e.message : "Fahrzeuge konnten nicht geladen werden.";
  }

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Fahrzeuge</h1>
        <p className="mt-1 text-sm text-gray-600">
          Unterlagen (PDF/Dokumente) je Fahrzeug ablegen, zuordnen und beschriften.
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-700">{error}</div>
      ) : (
        <VehicleDocuments vehicles={vehicles} />
      )}
    </div>
  );
}
