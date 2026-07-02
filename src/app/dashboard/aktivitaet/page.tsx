import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getGlobalLogbook, type GlobalLogEntry } from "@/app/dashboard/logbook-actions";
import ActivityLog from "@/components/ActivityLog";

export default async function AktivitaetPage() {
  if (!(await getSession())) redirect("/login");

  let entries: GlobalLogEntry[] = [];
  let error: string | null = null;
  try {
    entries = await getGlobalLogbook(300);
  } catch (e) {
    error = e instanceof Error ? e.message : "Aktivitäten konnten nicht geladen werden.";
  }

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Aktivitäts-Logbuch</h1>
        <p className="mt-1 text-sm text-gray-600">
          Alles, was projekt- und dokumentübergreifend passiert – Termine, Zuweisungen, Dokumente,
          Kommentare, Zeiten … (neueste zuerst).
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          Fehler beim Laden der Daten von HERO: {error}
        </div>
      )}

      <ActivityLog entries={entries} />
    </div>
  );
}
