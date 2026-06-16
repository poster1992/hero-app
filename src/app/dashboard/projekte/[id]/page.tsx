import Link from "next/link";
import YearSelector from "@/components/YearSelector";
import ReceiptsSummaryPanel from "@/components/ReceiptsSummaryPanel";
import ReceiptsTable from "@/components/ReceiptsTable";
import {
  getReceiptsForProject,
  getReceiptProjects,
  summarizeReceipts,
} from "@/lib/invoices";

function parseYear(value: string | undefined): number {
  const currentYear = new Date().getUTCFullYear();
  const parsed = value ? parseInt(value, 10) : currentYear;
  return Number.isFinite(parsed) ? parsed : currentYear;
}

export default async function ProjektPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const projectId = parseInt(id, 10);
  const sp = await searchParams;
  const nameParam = Array.isArray(sp.name) ? sp.name[0] : sp.name;
  const nrParam = Array.isArray(sp.nr) ? sp.nr[0] : sp.nr;
  const yearParam = Array.isArray(sp.year) ? sp.year[0] : sp.year;
  const year = parseYear(yearParam);

  let receipts: Awaited<ReturnType<typeof getReceiptsForProject>> | null = null;
  let error: string | null = null;
  if (!Number.isFinite(projectId)) {
    error = "Ungültige Projekt-ID.";
  } else {
    try {
      receipts = await getReceiptsForProject(year, projectId);
    } catch (e) {
      error = e instanceof Error ? e.message : "Unbekannter Fehler beim Laden der Daten.";
    }
  }

  // Project name/number: prefer the values passed via the link, else derive from a matching receipt.
  const derived = receipts
    ?.flatMap((r) => getReceiptProjects(r))
    .find((p) => p.id === projectId);
  const projectName = nameParam || derived?.name || `Projekt #${projectId}`;
  const projectNr = nrParam || (derived?.relativeId != null ? String(derived.relativeId) : null);

  const summary = summarizeReceipts(receipts ?? []);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
      <div>
        <Link
          href="/dashboard/projekte"
          className="text-xs text-gray-500 transition-colors hover:text-gray-800"
        >
          ← Zurück zur Projektübersicht
        </Link>
        <header className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">
              Projekt{projectNr ? ` · Nr. ${projectNr}` : ""}
            </p>
            <h1 className="text-2xl font-semibold text-gray-900">{projectName}</h1>
          </div>
          <YearSelector
            year={year}
            basePath={`/dashboard/projekte/${projectId}`}
            extraParams={{ name: nameParam, nr: nrParam }}
          />
        </header>
      </div>

      {error && (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          Fehler beim Laden der Daten von HERO: {error}
        </div>
      )}

      {receipts && <ReceiptsSummaryPanel summary={summary} />}

      {receipts && (
        <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
            <h2 className="text-lg font-medium text-gray-900">Belege {year}</h2>
            <p className="text-sm text-gray-600">{receipts.length} Belege</p>
          </div>

          {receipts.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-500">
              Keine Belege für dieses Projekt in {year}.
            </p>
          ) : (
            <ReceiptsTable receipts={receipts} partyLabel="Kontakt" showProject={false} />
          )}
        </div>
      )}
    </div>
  );
}
