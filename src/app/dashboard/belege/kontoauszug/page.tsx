import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listStatementUploads, listStatementMarkers, getStatementPageCount } from "@/lib/kontoauszuege";
import KontoauszugClient from "@/components/KontoauszugClient";

export default async function KontoauszugPage() {
  if (!(await getSession())) redirect("/login");

  const [uploads, markers, pageCount] = await Promise.all([
    listStatementUploads(),
    listStatementMarkers(),
    getStatementPageCount(),
  ]);

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-brand-red pb-2.5">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Kontoauszüge</h1>
          <p className="mt-1 text-sm text-gray-600">
            Neue PDF-Kontoauszüge werden hinten an eine gemeinsame Sammel-Datei angehängt. Seiten lassen sich
            mit einer Notiz markieren, um sie später wiederzufinden.
          </p>
        </div>
        <Link
          href="/dashboard/belege"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
        >
          ← Zu den Belegen
        </Link>
      </header>

      <KontoauszugClient initialUploads={uploads} initialMarkers={markers} initialPageCount={pageCount} />
    </div>
  );
}
