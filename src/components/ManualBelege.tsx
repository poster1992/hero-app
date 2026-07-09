import Link from "next/link";
import { listManualReceipts, searchManualOcrIds } from "@/lib/manual-receipts";
import { getManualOcrIndexStatus } from "@/app/dashboard/belege/manual-ocr-index";
import ManualOcrPanel from "@/components/ManualOcrPanel";
import { listChecklist } from "@/lib/belege-checklist";
import { getBookAccounts, getProjects } from "@/lib/hero-api";
import { setBelegPaidAction } from "@/app/dashboard/belege/manual-actions";
import ManualBelegeForm from "@/components/ManualBelegeForm";
import BelegEditButton from "@/components/BelegEditButton";
import DeleteBelegButton from "@/components/DeleteBelegButton";
import BelegeChecklist from "@/components/BelegeChecklist";
import { receiptDupKey } from "@/lib/receipt-duplicates";

const currencyFormatter = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const dateFormatter = new Intl.DateTimeFormat("de-DE");
const MONTH_LABELS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function formatDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? d : dateFormatter.format(dt);
}

export default async function ManualBelege({
  year,
  month,
  view,
  duplicateKeys,
  q = "",
}: {
  year: number;
  month: number;
  view: string;
  /** Dubletten-Schlüssel (Lieferant+Betrag+Datum) über HERO + manuelle Belege. */
  duplicateKeys?: Set<string>;
  /** Suchbegriff (Volltextsuche über die manuellen Belege). */
  q?: string;
}) {
  let receipts: Awaited<ReturnType<typeof listManualReceipts>> = [];
  let accounts: Awaited<ReturnType<typeof getBookAccounts>> = [];
  let checklist: Awaited<ReturnType<typeof listChecklist>> = [];
  let projects: Awaited<ReturnType<typeof getProjects>> = [];
  let ocrStatus = { total: 0, done: 0 };
  let error: string | null = null;
  try {
    [receipts, accounts, checklist, projects, ocrStatus] = await Promise.all([
      listManualReceipts(year),
      getBookAccounts(),
      listChecklist(year, month),
      getProjects().catch(() => []),
      getManualOcrIndexStatus().catch(() => ({ total: 0, done: 0 })),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Manuelle Belege konnten nicht geladen werden.";
  }

  // Bei aktiver Suche: zusätzlich die per OCR-Volltext passenden Beleg-IDs.
  const qTrim = q.trim();
  const ocrMatchIds = qTrim ? await searchManualOcrIds(qTrim).catch(() => new Set<number>()) : new Set<number>();

  // Suche: durchsucht die manuellen Belege (Lieferant, Beschreibung, Belegnr.,
  // Konto, Projekt, Datum, Betrag) – über das ganze Jahr, unabhängig vom Monat.
  const ql = q.trim().toLowerCase();
  const searchActive = ql.length > 0;
  const matchesQ = (r: (typeof receipts)[number]): boolean => {
    const hay = [
      r.supplier,
      r.description,
      r.invoiceNumber,
      r.accountNumber,
      r.accountName,
      r.projectName,
      r.projectRelativeId != null ? `#${r.projectRelativeId}` : "",
      r.date,
      String(r.gross).replace(".", ","),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    // Treffer über die strukturierten Felder ODER den OCR-Volltext des Belegs.
    return hay.includes(ql) || ocrMatchIds.has(r.id);
  };

  // Monatsfilter berücksichtigen (wie bei den HERO-Belegen oben); bei aktiver
  // Suche gilt der Suchfilter über das ganze Jahr.
  const filtered = searchActive
    ? receipts.filter(matchesQ)
    : view === "month"
      ? receipts.filter((r) => r.date && Number(r.date.slice(5, 7)) === month)
      : receipts;
  const periodLabel = searchActive
    ? `Suche „${q}" (${filtered.length})`
    : view === "month"
      ? `${MONTH_LABELS[month - 1]} ${year}`
      : String(year);
  const monthLabel = `${MONTH_LABELS[month - 1]} ${year}`;
  const total = filtered.reduce((s, r) => s + r.gross, 0);

  return (
    <div className="flex w-full max-w-none flex-col gap-6 px-6 pb-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Manuelle Belege</h1>
          <p className="mt-1 text-sm text-gray-600">
            Dokumente unabhängig von HERO hochladen und einem Konto zubuchen.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ManualOcrPanel status={ocrStatus} />
          <Link
            href="/dashboard/belege/posteingang"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
          >
            📥 Posteingang (Sammel-Upload)
          </Link>
          <ManualBelegeForm accounts={accounts} projects={projects} />
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      <BelegeChecklist items={checklist} year={year} month={month} periodLabel={monthLabel} />

      <div className="overflow-x-auto rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-medium text-gray-900">Erfasste Belege {periodLabel}</h2>
          <p className="text-sm text-gray-600">
            {filtered.length} Belege · {currencyFormatter.format(total)}
          </p>
        </div>
        {filtered.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-500">
            Keine manuellen Belege in diesem Zeitraum.
          </p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2 font-semibold">Datum</th>
                <th className="px-4 py-2 font-semibold">Lieferant</th>
                <th className="px-4 py-2 font-semibold">Beleg-Nr.</th>
                <th className="px-4 py-2 font-semibold">Beschreibung</th>
                <th className="px-4 py-2 font-semibold">Konto</th>
                <th className="px-4 py-2 font-semibold">Projekt</th>
                <th className="px-4 py-2 text-right font-semibold">Netto</th>
                <th className="px-4 py-2 text-right font-semibold">MwSt</th>
                <th className="px-4 py-2 text-right font-semibold">Brutto</th>
                <th className="px-4 py-2 text-right font-semibold">Skonto €</th>
                <th className="px-4 py-2 text-right font-semibold">Skontozahlbetrag</th>
                <th className="px-4 py-2 font-semibold">Skonto bis</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Beleg</th>
                <th className="px-4 py-2 font-semibold">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const dk = receiptDupKey(r.supplier, r.gross, r.date);
                const duplicate = dk != null && (duplicateKeys?.has(dk) ?? false);
                return (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="px-4 py-2 tabular-nums text-gray-700">{formatDate(r.date)}</td>
                  <td className="px-4 py-2 text-gray-900">
                    {r.supplier ?? "—"}
                    {duplicate && (
                      <span
                        title="Mögliche Dublette: gleicher Lieferant, Betrag und Datum wie ein anderer Beleg"
                        className="ml-1.5 whitespace-nowrap rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-500/40"
                      >
                        ⚠ Dublette
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-gray-700">{r.invoiceNumber ?? "—"}</td>
                  <td className="px-4 py-2 text-gray-600">{r.description ?? "—"}</td>
                  <td className="px-4 py-2 text-gray-700">
                    {r.accountNumber ? `${r.accountNumber} ${r.accountName ?? ""}` : "—"}
                  </td>
                  <td className="px-4 py-2 text-gray-700">
                    {r.projectId ? (
                      <a
                        href={`/dashboard/projekte/${r.projectId}?${new URLSearchParams({
                          ...(r.projectName ? { name: r.projectName } : {}),
                          ...(r.projectRelativeId != null ? { nr: String(r.projectRelativeId) } : {}),
                        }).toString()}`}
                        className="text-brand-red hover:underline"
                      >
                        {r.projectRelativeId != null ? `#${r.projectRelativeId} ` : ""}
                        {r.projectName ?? "Projekt"}
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                    {currencyFormatter.format(r.net)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                    {currencyFormatter.format(r.vat)}
                  </td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums text-gray-900">
                    {currencyFormatter.format(r.gross)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                    {r.skontoAmount != null ? currencyFormatter.format(r.skontoAmount) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                    {r.skontoPayAmount != null ? currencyFormatter.format(r.skontoPayAmount) : "—"}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-gray-700">{formatDate(r.skontoDueDate)}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      {r.isPaid ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          Bezahlt
                        </span>
                      ) : (
                        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
                          Offen
                        </span>
                      )}
                      <form action={setBelegPaidAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="paid" value={r.isPaid ? "0" : "1"} />
                        <button
                          type="submit"
                          className="rounded-md border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
                        >
                          {r.isPaid ? "auf offen" : "als bezahlt"}
                        </button>
                      </form>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    {r.hasFile ? (
                      <a
                        href={`/api/beleg?id=${r.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-red hover:underline"
                      >
                        ansehen
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      <BelegEditButton
                        accounts={accounts}
                        projects={projects}
                        receipt={r}
                        hasFile={r.hasFile}
                      />
                      <DeleteBelegButton id={r.id} label={r.supplier ?? r.description ?? `Beleg ${r.id}`} />
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
