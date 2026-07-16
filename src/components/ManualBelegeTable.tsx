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

const selectClass =
  "rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 outline-none focus:border-brand-red/60";

/** Filterbare Tabelle der manuellen Belege (clientseitig, ohne Reload). */
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
  const [status, setStatus] = useState<"" | "open" | "paid">("");
  const [account, setAccount] = useState("");
  const [project, setProject] = useState("");
  const [supplier, setSupplier] = useState("");
  const [beleg, setBeleg] = useState<"" | "with" | "without">("");

  // Auswahllisten aus den tatsächlich vorhandenen Belegen dieses Zeitraums.
  const accountOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) {
      if (r.accountNumber) m.set(r.accountNumber, `${r.accountNumber} ${r.accountName ?? ""}`.trim());
    }
    return Array.from(m, ([number, label]) => ({ number, label })).sort((a, b) =>
      a.number.localeCompare(b.number, "de")
    );
  }, [rows]);

  const projectOptions = useMemo(() => {
    const m = new Map<string, string>();
    let hasNone = false;
    for (const r of rows) {
      if (r.projectId) {
        m.set(
          String(r.projectId),
          `${r.projectRelativeId != null ? `#${r.projectRelativeId} ` : ""}${r.projectName ?? "Projekt"}`
        );
      } else hasNone = true;
    }
    const list = Array.from(m, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, "de"));
    return { list, hasNone };
  }, [rows]);

  const supplierOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.supplier?.trim()) s.add(r.supplier.trim());
    return Array.from(s).sort((a, b) => a.localeCompare(b, "de"));
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (status === "open" && r.isPaid) return false;
      if (status === "paid" && !r.isPaid) return false;
      if (account && r.accountNumber !== account) return false;
      if (project === "none" && r.projectId) return false;
      if (project && project !== "none" && String(r.projectId ?? "") !== project) return false;
      if (supplier && (r.supplier?.trim() ?? "") !== supplier) return false;
      if (beleg === "with" && !r.hasFile) return false;
      if (beleg === "without" && r.hasFile) return false;
      return true;
    });
  }, [rows, status, account, project, supplier, beleg]);

  const total = filtered.reduce((s, r) => s + r.gross, 0);
  const anyFilter = status !== "" || account !== "" || project !== "" || supplier !== "" || beleg !== "";
  const reset = () => {
    setStatus("");
    setAccount("");
    setProject("");
    setSupplier("");
    setBeleg("");
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-gray-200 px-5 py-4">
        <h2 className="text-lg font-medium text-gray-900">Erfasste Belege {periodLabel}</h2>
        <p className="text-sm text-gray-600">
          {filtered.length} {filtered.length === 1 ? "Beleg" : "Belege"} · {currencyFormatter.format(total)}
        </p>
      </div>

      {/* Filterleiste */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50/60 px-5 py-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Filter</span>
        <select value={status} onChange={(e) => setStatus(e.target.value as "" | "open" | "paid")} className={selectClass}>
          <option value="">Status: alle</option>
          <option value="open">Nur offene</option>
          <option value="paid">Nur bezahlte</option>
        </select>
        <select value={account} onChange={(e) => setAccount(e.target.value)} className={selectClass}>
          <option value="">Konto: alle</option>
          {accountOptions.map((a) => (
            <option key={a.number} value={a.number}>
              {a.label}
            </option>
          ))}
        </select>
        <select value={project} onChange={(e) => setProject(e.target.value)} className={selectClass}>
          <option value="">Projekt: alle</option>
          {projectOptions.hasNone && <option value="none">Ohne Projekt</option>}
          {projectOptions.list.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <select value={supplier} onChange={(e) => setSupplier(e.target.value)} className={selectClass}>
          <option value="">Lieferant: alle</option>
          {supplierOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={beleg} onChange={(e) => setBeleg(e.target.value as "" | "with" | "without")} className={selectClass}>
          <option value="">Beleg: alle</option>
          <option value="with">Nur mit Beleg</option>
          <option value="without">Nur ohne Beleg</option>
        </select>
        {anyFilter && (
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
          >
            Zurücksetzen
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-gray-500">
          {anyFilter ? "Keine Belege für die gewählten Filter." : "Keine manuellen Belege in diesem Zeitraum."}
        </p>
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
            {filtered.map((r) => (
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
