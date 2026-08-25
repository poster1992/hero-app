import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getProjects, getProjectPipeline } from "@/lib/hero-api";
import LagerHero from "@/components/LagerHero";
import type { LagerItem, LagerProjectOption } from "@/lib/material-types";
import { loadLagerItems } from "./shared";

export default async function LagerPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let items: LagerItem[] = [];
  let projects: LagerProjectOption[] = [];
  let error: string | null = null;
  try {
    const [loaded, projs, pipeline] = await Promise.all([
      loadLagerItems(),
      getProjects(),
      getProjectPipeline().catch(() => null),
    ]);
    items = loaded;
    // Projekte in der Pipeline-Phase „In Umsetzung" (phaseCode 1111) markieren –
    // Ausbuchen ist nur auf diese Projekte erlaubt.
    const inUmsetzung = new Set<number>();
    for (const st of pipeline?.stages ?? []) {
      if (st.phaseCode === 1111) for (const pr of st.projects) inUmsetzung.add(pr.id);
    }
    projects = projs.map((p) => ({
      id: p.id,
      relativeId: p.relativeId,
      name: p.name,
      inImplementation: inUmsetzung.has(p.id),
    }));
  } catch (e) {
    error = e instanceof Error ? e.message : "Lager konnte nicht geladen werden.";
  }

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Lager · Ein-/Ausbuchen</h1>
        <p className="mt-1 text-sm text-gray-600">
          Artikel aus HERO · Bestände werden lokal geführt (ein- und abbuchen).
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : (
        <LagerHero items={items} projects={projects} />
      )}
    </div>
  );
}
