import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listStatementUploads, listStatementMarkers, getStatementPageCount } from "@/lib/kontoauszuege";
import KontoauszugClient from "@/components/KontoauszugClient";

/**
 * Eigenständige Seite AUSSERHALB von /dashboard (kein Sidebar-Layout) – wird
 * bewusst in einem eigenen Browserfenster geöffnet (siehe Link in
 * MonthlyReceipts.tsx), damit der volle Platz für PDF-Ansicht + Markieren zur
 * Verfügung steht, ohne Menü drumherum.
 */
export default async function KontoauszuegeStandalonePage() {
  if (!(await getSession())) redirect("/login");

  const [uploads, markers, pageCount] = await Promise.all([
    listStatementUploads(),
    listStatementMarkers(),
    getStatementPageCount(),
  ]);

  return (
    <div className="flex min-h-screen w-full max-w-full flex-1 flex-col gap-4 bg-paper px-6 py-6">
      <header className="border-b-2 border-brand-red pb-2.5">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Kontoauszüge</h1>
        <p className="mt-1 text-sm text-gray-600">
          Neue PDF-Kontoauszüge werden vorn in eine gemeinsame Sammel-Datei eingefügt. Seiten lassen sich mit
          einer Notiz markieren oder direkt im PDF mit der Maus markieren, um sie später wiederzufinden.
        </p>
      </header>

      <KontoauszugClient initialUploads={uploads} initialMarkers={markers} initialPageCount={pageCount} />
    </div>
  );
}
