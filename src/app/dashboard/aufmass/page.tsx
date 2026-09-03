import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getAllowedModules } from "@/lib/role-store";
import { listAufmasse } from "@/lib/aufmass";
import AufmassClient from "@/components/AufmassClient";
import type { AufmassEntry } from "@/lib/aufmass-types";

export default async function AufmassPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const me = await getUserByUsername(session.username);
  const allowed = me ? await getAllowedModules(me.role) : [];

  if (!allowed.includes("cockpit_aufmass")) {
    return (
      <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Aufmaß</h1>
        <p className="text-sm text-gray-500">Für diesen Bereich fehlt dir die Berechtigung.</p>
      </div>
    );
  }

  let entries: AufmassEntry[] = [];
  let error: string | null = null;
  try {
    entries = await listAufmasse();
  } catch (e) {
    error = e instanceof Error ? e.message : "Aufmaße konnten nicht geladen werden.";
  }

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      <header className="border-b-2 border-brand-red pb-2.5">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Aufmaß</h1>
        <p className="mt-1 text-sm text-gray-600">
          Handschriftliches Aufmaß hineinziehen – daraus entsteht ein Word-Dokument mit Kopfdaten,
          Positionstabelle und Summen, das direkt bearbeitet werden kann.
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-brand-red-dark">
          {error}
        </div>
      ) : (
        <AufmassClient initial={entries} />
      )}
    </div>
  );
}
