"use client";

import { useMemo, useState } from "react";
import {
  getProjectPlanningSummary,
  type ProjectPlanningSummary,
} from "@/app/dashboard/planung/project-actions";

export interface ProjectOption {
  id: number;
  relativeId: number | null;
  name: string;
  customerName: string | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const hoursFmt = (n: number) => `${round1(n).toLocaleString("de-DE")} h`;

export default function ProjectPlanningSearch({ projects }: { projects: ProjectOption[] }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ProjectOption | null>(null);
  const [summary, setSummary] = useState<ProjectPlanningSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return projects
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.customerName?.toLowerCase().includes(q) ?? false) ||
          (p.relativeId != null && String(p.relativeId).includes(q))
      )
      .slice(0, 8);
  }, [query, projects]);

  async function select(p: ProjectOption) {
    setSelected(p);
    setQuery("");
    setSummary(null);
    setError(null);
    setLoading(true);
    try {
      setSummary(await getProjectPlanningSummary(p.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler beim Laden.");
    } finally {
      setLoading(false);
    }
  }

  const remaining =
    summary != null ? round1(summary.calculatedHours - summary.plannedHours) : 0;

  return (
    <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
      <h2 className="text-lg font-semibold text-gray-900">Projekt-Stunden</h2>
      <p className="mt-1 text-sm text-gray-600">
        Projekt suchen: kalkulierte vs. bereits verplante Arbeitsstunden.
      </p>

      <div className="relative mt-3 max-w-md">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Projektname, Kunde oder Projektnummer …"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60"
        />
        {matches.length > 0 && (
          <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
            {matches.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => select(p)}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-gray-100"
                >
                  <span className="font-medium text-gray-900">
                    {p.relativeId != null && (
                      <span className="text-gray-500">#{p.relativeId} </span>
                    )}
                    {p.name}
                  </span>
                  {p.customerName && (
                    <span className="text-xs text-gray-500">{p.customerName}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected && (
        <div className="mt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-gray-900">
              {selected.relativeId != null && (
                <span className="text-gray-500">#{selected.relativeId} </span>
              )}
              {selected.name}
              {selected.customerName ? ` · ${selected.customerName}` : ""}
            </p>
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setSummary(null);
                setError(null);
              }}
              className="text-xs text-gray-400 hover:text-gray-700"
            >
              ✕ zurücksetzen
            </button>
          </div>

          {loading && <p className="text-sm text-gray-500">Lade Stunden …</p>}
          {error && (
            <p className="rounded-md border border-brand-red/30 bg-brand-red/10 p-3 text-sm text-red-300">
              {error}
            </p>
          )}

          {summary && !loading && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-center">
                <p className="text-xs text-gray-500">Kalkuliert (Soll)</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">
                  {hoursFmt(summary.calculatedHours)}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-center">
                <p className="text-xs text-gray-500">Verplant</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">
                  {hoursFmt(summary.plannedHours)}
                </p>
                <p className="mt-0.5 text-xs text-gray-400">{summary.eventCount} Termine</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-center">
                <p className="text-xs text-gray-500">Verbleibend</p>
                <p
                  className={`mt-1 text-2xl font-semibold ${
                    remaining < 0 ? "text-rose-600" : "text-emerald-700"
                  }`}
                >
                  {hoursFmt(remaining)}
                </p>
                <p className="mt-0.5 text-xs text-gray-400">Kalkuliert − Verplant</p>
              </div>
            </div>
          )}

          {summary && !loading && (
            <div className="mt-4">
              <h3 className="mb-1 text-sm font-semibold text-gray-700">
                Verplante Termine
              </h3>
              {summary.entries.length === 0 ? (
                <p className="text-sm text-gray-400">Noch keine Termine verplant.</p>
              ) : (
                <div className="max-h-72 overflow-y-auto rounded-md border border-gray-200">
                  <table className="w-full border-collapse text-sm">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                        <th className="px-3 py-1.5 font-semibold">Datum</th>
                        <th className="px-3 py-1.5 font-semibold">Mitarbeiter</th>
                        <th className="px-3 py-1.5 text-right font-semibold">Std.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.entries.map((en) => (
                        <tr key={en.id} className="border-t border-gray-100">
                          <td className="px-3 py-1.5 text-gray-900">{en.dateLabel}</td>
                          <td className="px-3 py-1.5 text-gray-600">
                            {en.employees.length > 0 ? en.employees.join(", ") : "—"}
                          </td>
                          <td className="px-3 py-1.5 text-right font-medium text-gray-700">
                            {hoursFmt(en.manHours)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
