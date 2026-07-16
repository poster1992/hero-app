"use client";

import { useMemo, useState } from "react";
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

/** Suchtext für Betragsspalten: formatiert + roh (mit Komma), damit "1234" und "1.234,56" treffen. */
function money(x: number | null): string {
  if (x == null) return "";
  return `${currencyFormatter.format(x)} ${String(x).replace(".", ",")}`;
}

/** Textspalten, die per Eingabefeld im Tabellenkopf gefiltert werden. */
const TEXT_COLS = [
  "datum",
  "lieferant",
  "belegnr",
  "konto",
  "projekt",
  "netto",
  "mwst",
  "brutto",
  "skonto",
  "skontozahl",
  "skontobis",
] as const;
type TextCol = (typeof TEXT_COLS)[number];

const filterInputClass =
  "w-full min-w-0 rounded border border-gray-300 bg-white px-1.5 py-1 text-xs font-normal normal-case text-gray-700 outline-none focus:border-brand-red/60";

/** Tabelle der manuellen Belege mit Spalten-Filtern im Tabellenkopf.
 *  Die View-Reiter oben (Monatlich/Alle/Offen/Fällig, Suche) filtern bereits
 *  serverseitig vor; die Kopf-Filter verfeinern die Anzeige clientseitig. */
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
  const [text, setText] = useState<Record<TextCol, string>>({
    datum: "",
    lieferant: "",
    belegnr: "",
    konto: "",
    projekt: "",
    netto: "",
    mwst: "",
    brutto: "",
    skonto: "",
    skontozahl: "",
    skontobis: "",
  });
  const [status, setStatus] = useState<"" | "open" | "paid">("");
  const [beleg, setBeleg] = useState<"" | "with" | "without">("");

  const setCol = (col: TextCol, value: string) => setText((t) => ({ ...t, [col]: value }));

  // Filter-Suchwerte je Zeile (auf den angezeigten Spaltentext).
  const searchValues = useMemo(
    () =>
      new Map<number, Record<TextCol, string>>(
        rows.map((r) => [
          r.id,
          {
            datum: formatDate(r.date),
            lieferant: r.supplier ?? "",
            belegnr: r.invoiceNumber ?? "",
            konto: r.accountNumber ? `${r.accountNumber} ${r.accountName ?? ""}` : "",
            projekt: r.projectId
              ? `${r.projectRelativeId != null ? `#${r.projectRelativeId} ` : ""}${r.projectName ?? "Projekt"}`
              : "",
            netto: money(r.net),
            mwst: money(r.vat),
            brutto: money(r.gross),
            skonto: money(r.skontoAmount),
            skontozahl: money(r.skontoPayAmount),
            skontobis: formatDate(r.skontoDueDate),
          },
        ])
      ),
    [rows]
  );

  const filtered = useMemo(() => {
    const active = TEXT_COLS.filter((c) => text[c].trim()).map((c) => [c, text[c].trim().toLowerCase()] as const);
    return rows.filter((r) => {
      if (status === "open" && r.isPaid) return false;
      if (status === "paid" && !r.isPaid) return false;
      if (beleg === "with" && !r.hasFile) return false;
      if (beleg === "without" && r.hasFile) return false;
      const v = searchValues.get(r.id);
      if (!v) return true;
      for (const [col, q] of active) {
        if (!v[col].toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, text, status, beleg, searchValues]);

  const total = filtered.reduce((s, r) => s + r.gross, 0);
  const anyFilter = status !== "" || beleg !== "" || TEXT_COLS.some((c) => text[c].trim() !== "");
  const reset = () => {
    setText({
      datum: "",
      lieferant: "",
      belegnr: "",
      konto: "",
      projekt: "",
      netto: "",
      mwst: "",
      brutto: "",
      skonto: "",
      skontozahl: "",
      skontobis: "",
    });
    setStatus("");
    setBeleg("");
  };

  const colInput = (col: TextCol, align: "left" | "right" = "left") => (
    <input
      value={text[col]}
      onChange={(e) => setCol(col, e.target.value)}
      placeholder="Filter"
      className={`${filterInputClass} ${align === "right" ? "text-right" : ""}`}
    />
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-gray-200 px-5 py-4">
        <h2 className="text-lg font-medium text-gray-900">Erfasste Belege {periodLabel}</h2>
        <div className="flex items-center gap-3">
          <p className="text-sm text-gray-600">
            {filtered.length} {filtered.length === 1 ? "Beleg" : "Belege"} · {currencyFormatter.format(total)}
          </p>
          {anyFilter && (
            <button
              type="button"
              onClick={reset}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
            >
              Filter zurücksetzen
            </button>
          )}
        </div>
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
            {/* Filterzeile im Tabellenkopf */}
            <tr className="border-t border-gray-200 bg-white align-top">
              <th className="px-2 py-1.5">{colInput("datum")}</th>
              <th className="px-2 py-1.5">{colInput("lieferant")}</th>
              <th className="px-2 py-1.5">{colInput("belegnr")}</th>
              <th className="px-2 py-1.5">{colInput("konto")}</th>
              <th className="px-2 py-1.5">{colInput("projekt")}</th>
              <th className="px-2 py-1.5">{colInput("netto", "right")}</th>
              <th className="px-2 py-1.5">{colInput("mwst", "right")}</th>
              <th className="px-2 py-1.5">{colInput("brutto", "right")}</th>
              <th className="px-2 py-1.5">{colInput("skonto", "right")}</th>
              <th className="px-2 py-1.5">{colInput("skontozahl", "right")}</th>
              <th className="px-2 py-1.5">{colInput("skontobis")}</th>
              <th className="px-2 py-1.5">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "" | "open" | "paid")}
                  className={filterInputClass}
                >
                  <option value="">Alle</option>
                  <option value="open">Offen</option>
                  <option value="paid">Bezahlt</option>
                </select>
              </th>
              <th className="px-2 py-1.5">
                <select
                  value={beleg}
                  onChange={(e) => setBeleg(e.target.value as "" | "with" | "without")}
                  className={filterInputClass}
                >
                  <option value="">Alle</option>
                  <option value="with">Mit</option>
                  <option value="without">Ohne</option>
                </select>
              </th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={14} className="px-5 py-8 text-center text-sm text-gray-500">
                  Keine Belege für die gewählten Spaltenfilter.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
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
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
