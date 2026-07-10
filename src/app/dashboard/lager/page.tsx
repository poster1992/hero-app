import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getLocalQuantities,
  getLocalEkPrices,
  getLocalMinMax,
  listRecentMovements,
  syncArticleMaster,
} from "@/lib/materials";
import { getUserByUsername } from "@/lib/users";
import { getAllowedModules } from "@/lib/role-store";
import { getStockArticles, getProjects } from "@/lib/hero-api";
import LagerHero, { type LagerItem } from "@/components/LagerHero";

export default async function LagerPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const me = await getUserByUsername(session.username);
  const allowed = me ? await getAllowedModules(me.role) : [];
  const canSeeEk = allowed.includes("lager_ek");

  let items: LagerItem[] = [];
  let movements: Awaited<ReturnType<typeof listRecentMovements>> = [];
  let projects: { id: number; relativeId: number | null; name: string }[] = [];
  let error: string | null = null;
  try {
    const [articles, mv, projs] = await Promise.all([
      getStockArticles(),
      listRecentMovements(),
      getProjects(),
    ]);
    // EK-Preise + Stammdaten lokal übernehmen (gespeichert, nicht angezeigt),
    // danach lokale Bestände lesen.
    await syncArticleMaster(
      articles.map((a) => ({
        id: a.id,
        name: a.name,
        itemNumber: a.itemNumber,
        unit: a.unit,
        purchasePrice: a.purchasePrice,
      }))
    );
    const [localQ, localEk, localMinMax] = await Promise.all([
      getLocalQuantities(),
      getLocalEkPrices(),
      getLocalMinMax(),
    ]);
    items = articles.map((a) => {
      const mm = localMinMax.get(a.id);
      return {
        id: a.id,
        name: a.name,
        itemNumber: a.itemNumber,
        qrId: a.qrId,
        unit: a.unit,
        category: a.category,
        quantity: localQ.get(a.id) ?? 0, // lokaler Bestand aus MySQL (HERO-Bestand ignoriert)
        ekPrice: localEk.get(a.id) ?? 0,
        minStock: mm?.min ?? null,
        maxStock: mm?.max ?? null,
      };
    });
    movements = mv;
    projects = projs.map((p) => ({ id: p.id, relativeId: p.relativeId, name: p.name }));
  } catch (e) {
    error = e instanceof Error ? e.message : "Lager konnte nicht geladen werden.";
  }

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Lager</h1>
        <p className="mt-1 text-sm text-gray-600">
          Artikel aus HERO · Bestände werden lokal geführt (ein- und abbuchen).
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : (
        <LagerHero items={items} movements={movements} projects={projects} canSeeEk={canSeeEk} />
      )}
    </div>
  );
}
