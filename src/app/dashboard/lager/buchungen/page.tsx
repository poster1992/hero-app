import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getAllowedModules } from "@/lib/role-store";
import { listRecentMovements, listOutboundArticlesWithoutEk, type MissingEkArticle } from "@/lib/materials";
import { getProjects } from "@/lib/hero-api";
import LagerMovements, { type MovementProjectOption } from "@/components/LagerMovements";
import type { StockMovement } from "@/lib/material-types";

export default async function LagerBuchungenPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const isAdmin = session.role === "administrator";
  const allowed = await getAllowedModules(session.role);
  const canStats = allowed.includes("lager_statistik");
  // Recht „lager_ek": EK-Preise sehen und (hier) nachtragen.
  const canEk = allowed.includes("lager_ek");

  let movements: StockMovement[] = [];
  let projects: MovementProjectOption[] = [];
  let missingEk: MissingEkArticle[] = [];
  let error: string | null = null;
  try {
    movements = await listRecentMovements();
    if (canEk) missingEk = await listOutboundArticlesWithoutEk().catch(() => []);
    // Projektliste nur für Admins (zum Bearbeiten der Buchung nötig).
    if (isAdmin) {
      projects = (await getProjects().catch(() => []))
        .map((p) => ({ relativeId: p.relativeId, name: p.name }))
        .filter((p) => p.relativeId != null);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Buchungen konnten nicht geladen werden.";
  }

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      <header className="border-b-2 border-brand-red pb-2.5">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Lager · Letzte Buchungen</h1>
        <p className="mt-1 text-sm text-gray-600">Die zuletzt erfassten Ein- und Ausbuchungen.</p>
      </header>

      {error ? (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-brand-red-dark">
          {error}
        </div>
      ) : (
        <LagerMovements
          movements={movements}
          isAdmin={isAdmin}
          canStats={canStats}
          canEk={canEk}
          missingEk={missingEk}
          projects={projects}
        />
      )}
    </div>
  );
}
