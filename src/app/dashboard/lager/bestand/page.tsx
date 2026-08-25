import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getAllowedModules } from "@/lib/role-store";
import LagerBestand from "@/components/LagerBestand";
import type { LagerItem } from "@/lib/material-types";
import { loadLagerItems } from "../shared";

export default async function LagerBestandPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const me = await getUserByUsername(session.username);
  const allowed = me ? await getAllowedModules(me.role) : [];
  // Leserecht für die Artikelbestandsliste (Bestand ansehen).
  const canRead = allowed.includes("lager_bestand");
  // Schreibrecht (Min/Max bearbeiten).
  const canEdit = allowed.includes("lager_bestand_edit");
  const canSeeEk = allowed.includes("lager_ek");

  if (!canRead) {
    return (
      <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
        <h1 className="text-2xl font-semibold text-gray-900">Lager · Artikelbestandsliste</h1>
        <p className="text-sm text-gray-500">Für diesen Bereich fehlt dir die Berechtigung.</p>
      </div>
    );
  }

  let items: LagerItem[] = [];
  let error: string | null = null;
  try {
    items = await loadLagerItems();
  } catch (e) {
    error = e instanceof Error ? e.message : "Artikelbestandsliste konnte nicht geladen werden.";
  }

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Lager · Artikelbestandsliste</h1>
        <p className="mt-1 text-sm text-gray-600">
          Alle Artikel mit lokalem Bestand, Min/Max{canSeeEk ? " und EK-Preis" : ""}.
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-brand-red-dark">
          {error}
        </div>
      ) : (
        <LagerBestand items={items} canSeeEk={canSeeEk} canEdit={canEdit} />
      )}
    </div>
  );
}
