import { setBelegPaidAction } from "@/app/dashboard/belege/manual-actions";
import BelegEditButton from "@/components/BelegEditButton";
import DeleteBelegButton from "@/components/DeleteBelegButton";
import type { ProjectOption } from "@/components/ManualBelegeForm";
import type { ManualReceipt } from "@/lib/manual-receipts";

type AccountOption = { number: string; name: string };
export type BelegRow = ManualReceipt & { duplicate: boolean };

const currencyFormatter = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const dateFormatter = new Intl.DateTimeFormat("de-DE");

function formatDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? d : dateFormatter.format(dt);
}

/** Tabelle der manuellen Belege. Die Filterung (Monatlich/Alle/Offen/Fällig, Suche)
 *  läuft – wie bei den HERO-Belegen – über die View-Reiter oben (rows kommen fertig
 *  gefiltert vom Server). */
export default function ManualBelegeTable({
  rows,
  accounts,
  projects,
  periodLabel,
}: {
  rows: BelegRow[];
  accounts: AccountOption[];
  projects: ProjectOption[];
  periodLabel: string;
}) {
  const total = rows.reduce((s, r) => s + r.gross, 0);

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-gray-200 px-5 py-4">
        <h2 className="text-lg font-medium text-gray-900">Erfasste Belege {periodLabel}</h2>
        <p className="text-sm text-gray-600">
          {rows.length} {rows.length === 1 ? "Beleg" : "Belege"} · {currencyFormatter.format(total)}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-gray-500">Keine manuellen Belege in diesem Zeitraum.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-3 py-1.5 font-semibold">Datum</th>
              <th className="px-3 py-1.5 font-semibold">Lieferant</th>
              <th className="px-3 py-1.5 font-semibold">Beleg-Nr.</th>
              <th className="px-3 py-1.5 font-semibold">Konto</th>
              <th className="px-3 py-1.5 font-semibold">Projekt</th>
              <th className="px-3 py-1.5 text-right font-semibold">Netto</th>
              <th className="px-3 py-1.5 text-right font-semibold">MwSt</th>
              <th className="px-3 py-1.5 text-right font-semibold">Brutto</th>
              <th className="px-3 py-1.5 text-right font-semibold">Skonto €</th>
              <th className="px-3 py-1.5 text-right font-semibold">Skontozahlbetrag</th>
              <th className="px-3 py-1.5 font-semibold">Skonto bis</th>
              <th className="px-3 py-1.5 font-semibold">Status</th>
              <th className="px-3 py-1.5 font-semibold">Beleg</th>
              <th className="px-3 py-1.5 font-semibold">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="px-3 py-1.5 tabular-nums text-gray-700">{formatDate(r.date)}</td>
                <td className="px-3 py-1.5 text-gray-900">
                  {r.supplier ?? "—"}
                  {r.duplicate && (
                    <span
                      title="Mögliche Dublette: gleicher Lieferant, Betrag und Datum wie ein anderer Beleg"
                      className="ml-1.5 whitespace-nowrap rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-500/40"
                    >
                      ⚠ Dublette
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 tabular-nums text-gray-700">{r.invoiceNumber ?? "—"}</td>
                <td className="px-3 py-1.5 text-gray-700">
                  {r.accountNumber ? `${r.accountNumber} ${r.accountName ?? ""}` : "—"}
                </td>
                <td className="px-3 py-1.5 text-gray-700">
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
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{currencyFormatter.format(r.net)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{currencyFormatter.format(r.vat)}</td>
                <td className="px-3 py-1.5 text-right font-medium tabular-nums text-gray-900">
                  {currencyFormatter.format(r.gross)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                  {r.skontoAmount != null ? currencyFormatter.format(r.skontoAmount) : "—"}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                  {r.skontoPayAmount != null ? currencyFormatter.format(r.skontoPayAmount) : "—"}
                </td>
                <td className="px-3 py-1.5 tabular-nums text-gray-700">{formatDate(r.skontoDueDate)}</td>
                <td className="px-3 py-1.5">
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
                <td className="px-3 py-1.5">
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
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <BelegEditButton accounts={accounts} projects={projects} receipt={r} hasFile={r.hasFile} />
                    <DeleteBelegButton id={r.id} label={r.supplier ?? r.description ?? `Beleg ${r.id}`} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
