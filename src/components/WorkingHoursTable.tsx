"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { TrackingTimeEntry } from "@/lib/hero-api";

const hoursFmt = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const dateFmt = new Intl.DateTimeFormat("de-DE");

interface EmployeeAgg {
  name: string;
  total: number;
  entries: TrackingTimeEntry[];
}

export default function WorkingHoursTable({ entries }: { entries: TrackingTimeEntry[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [selected]);

  const employees = useMemo(() => {
    const map = new Map<string, EmployeeAgg>();
    for (const e of entries) {
      const agg = map.get(e.partnerName) ?? { name: e.partnerName, total: 0, entries: [] };
      agg.total += e.durationHours;
      agg.entries.push(e);
      map.set(e.partnerName, agg);
    }
    return [...map.values()]
      .map((a) => ({ ...a, total: Math.round(a.total * 100) / 100 }))
      .sort((a, b) => b.total - a.total);
  }, [entries]);

  const totalHours = useMemo(() => employees.reduce((s, e) => s + e.total, 0), [employees]);

  const active = selected ? employees.find((e) => e.name === selected) ?? null : null;

  // Aufschlüsselung des gewählten Mitarbeiters nach Projekt.
  const byProject = useMemo(() => {
    if (!active) return [];
    const map = new Map<string, number>();
    for (const e of active.entries) {
      const key = e.projectName ?? "Ohne Projekt";
      map.set(key, (map.get(key) ?? 0) + e.durationHours);
    }
    return [...map.entries()]
      .map(([name, hours]) => ({ name, hours: Math.round(hours * 100) / 100 }))
      .sort((a, b) => b.hours - a.hours);
  }, [active]);

  const sortedEntries = useMemo(() => {
    if (!active) return [];
    return [...active.entries].sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
  }, [active]);

  if (employees.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-sm text-gray-500">
        Keine Arbeitszeiten in diesem Monat.
      </p>
    );
  }

  const modal = active && (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
      onClick={() => setSelected(null)}
    >
      <div
        className="my-6 w-full max-w-2xl rounded-xl border border-gray-300 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Mitarbeiter</p>
            <h2 className="text-xl font-semibold text-gray-900">{active.name}</h2>
            <p className="mt-0.5 text-sm text-gray-600">
              {hoursFmt.format(active.total)} h · {active.entries.length} Buchungen
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-brand-red/50 hover:text-brand-red"
          >
            Schließen
          </button>
        </div>

        <div className="max-h-[75vh] overflow-y-auto px-6 py-5">
          <h3 className="mb-2 text-sm font-medium text-gray-700">Nach Projekt</h3>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {byProject.map((proj) => (
              <li key={proj.name} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{proj.name}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900">
                  {hoursFmt.format(proj.hours)} h
                </span>
              </li>
            ))}
            <li className="flex items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-4 py-2">
              <span className="text-sm font-semibold text-gray-900">Summe</span>
              <span className="text-sm font-semibold tabular-nums text-gray-900">
                {hoursFmt.format(active.total)} h
              </span>
            </li>
          </ul>

          <h3 className="mb-2 mt-6 text-sm font-medium text-gray-700">Einzelbuchungen</h3>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {sortedEntries.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-2">
                <span className="w-20 shrink-0 text-xs text-gray-500">
                  {e.start ? dateFmt.format(new Date(e.start)) : "—"}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-gray-800">
                  {e.projectName ?? "Ohne Projekt"}
                  {e.comment && (
                    <span className="ml-2 truncate text-xs text-gray-500">{e.comment}</span>
                  )}
                </span>
                <span className="shrink-0 text-sm tabular-nums text-gray-700">
                  {hoursFmt.format(e.durationHours)} h
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
            <th className="px-5 py-3 font-medium">Mitarbeiter</th>
            <th className="px-5 py-3 font-medium text-right">Stunden</th>
            <th className="px-5 py-3 font-medium text-right">Buchungen</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((e) => (
            <tr
              key={e.name}
              onClick={() => setSelected(e.name)}
              className="cursor-pointer border-b border-gray-200 last:border-0 hover:bg-gray-100"
            >
              <td className="px-5 py-3 font-medium text-brand-red">{e.name}</td>
              <td className="px-5 py-3 text-right whitespace-nowrap text-gray-800">
                {hoursFmt.format(e.total)} h
              </td>
              <td className="px-5 py-3 text-right whitespace-nowrap text-gray-500">
                {e.entries.length}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-300 text-sm font-semibold text-gray-900">
            <td className="px-5 py-3">Summe</td>
            <td className="px-5 py-3 text-right whitespace-nowrap">{hoursFmt.format(totalHours)} h</td>
            <td className="px-5 py-3 text-right whitespace-nowrap">{entries.length}</td>
          </tr>
        </tfoot>
      </table>

      {mounted && modal && createPortal(modal, document.body)}
    </>
  );
}
