import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getAllowedModules } from "@/lib/role-store";
import { getProjects, type ProjectSummary } from "@/lib/hero-api";
import GalerieClient from "@/components/GalerieClient";

export default async function GaleriePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const user = await getUserByUsername(session.username);
  if (!user) redirect("/login");
  const allowed = await getAllowedModules(user.role);
  if (!allowed.includes("cockpit_galerie")) redirect("/dashboard");

  let projects: ProjectSummary[] = [];
  let error: string | null = null;
  try {
    projects = await getProjects();
  } catch (e) {
    error = e instanceof Error ? e.message : "Projekte konnten nicht geladen werden.";
  }

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-4 py-8">
      <header className="border-b-2 border-brand-red pb-2.5">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Bilder-Galerie</h1>
        <p className="mt-1 text-sm text-gray-600">
          Alle Projekt-Fotos aus HERO an einer Stelle. Projekt suchen/aufklappen – die Fotos werden erst dann
          geladen, damit die Seite beim Öffnen schnell bleibt.
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-700">{error}</div>
      ) : (
        <GalerieClient projects={projects} />
      )}
    </div>
  );
}
