"use client";

import { useEffect, useState } from "react";
import type { PlanboardWeek } from "@/lib/planning-data";
import { absenceStyle } from "@/lib/planboard-colors";

const round1 = (n: number) => Math.round(n * 10) / 10;
const hoursFmt = (n: number) => `${round1(n).toLocaleString("de-DE")} h`;

/**
 * Plantafel as an employee × day matrix: employees stacked down the left,
 * days across the top, each cell holding that employee's appointments.
 * Right-clicking a day cell opens a Plan/Ist detail popup for that employee.
 */
export default function PlanboardCalendar({ week }: { week: PlanboardWeek }) {
  const { days, rows } = week;
  const [sel, setSel] = useState<{ rowIdx: number; dayIdx: number } | null>(null);

  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSel(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel]);

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
        Keine Termine in dieser Woche.
      </p>
    );
  }

  const cols = "grid-cols-[11rem_repeat(7,minmax(0,1fr))]";

  function dayCellClass(isToday: boolean, isWeekend: boolean): string {
    if (isToday) return "bg-brand-red/5";
    if (isWeekend) return "bg-gray-50";
    return "bg-white";
  }

  const selRow = sel ? rows[sel.rowIdx] : null;
  const selDay = sel ? days[sel.dayIdx] : null;
  const selPlanned = sel && selRow ? selRow.cells[sel.dayIdx] : [];
  const selWorked = sel && selRow ? selRow.workedCells[sel.dayIdx] : [];
  const selAbsences = sel && selRow ? selRow.absenceCells[sel.dayIdx] : [];
  const plannedTotal = selPlanned.reduce((s, e) => s + e.hours, 0);
  const workedTotal = selWorked.reduce((s, e) => s + e.hours, 0);

  // Plan vs Ist juxtaposed per project (events without a project go to one bucket).
  const projKey = (relId: number | null, name: string | null) =>
    relId != null ? `#${relId}` : name ? `n:${name}` : "__none__";
  const projLabel = (relId: number | null, name: string | null) =>
    relId != null ? `#${relId}${name ? ` ${name}` : ""}` : name || "(ohne Projekt)";
  const compareMap = new Map<string, { key: string; label: string; plan: number; ist: number }>();
  for (const e of selPlanned) {
    const k = projKey(e.projectRelativeId, e.projectName);
    const r = compareMap.get(k) ?? { key: k, label: projLabel(e.projectRelativeId, e.projectName), plan: 0, ist: 0 };
    r.plan += e.hours;
    compareMap.set(k, r);
  }
  for (const w of selWorked) {
    const k = projKey(w.projectRelativeId, w.projectName);
    const r = compareMap.get(k) ?? { key: k, label: projLabel(w.projectRelativeId, w.projectName), plan: 0, ist: 0 };
    r.ist += w.hours;
    compareMap.set(k, r);
  }
  const compareRows = [...compareMap.values()].sort((a, b) => a.label.localeCompare(b.label, "de"));

  return (
    <div className="flex flex-col gap-2">
      <p className="px-1 text-xs text-gray-500">
        Tipp: Rechtsklick auf einen Tag zeigt Plan- und Ist-Stunden des Mitarbeiters.
      </p>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <div className="min-w-[900px]">
          {/* Header: corner + day labels */}
          <div className={`grid ${cols} border-b border-gray-200 bg-gray-50`}>
            <div className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500">
              Mitarbeiter
            </div>
            {days.map((d) => (
              <div
                key={d.date}
                className={`border-l border-gray-200 px-2 py-2 text-center text-xs font-semibold ${
                  d.isToday ? "text-brand-red" : "text-gray-700"
                }`}
              >
                {d.label}
              </div>
            ))}
          </div>

          {/* One row per employee */}
          {rows.map((row, rowIdx) => (
            <div
              key={row.employeeId}
              className={`grid ${cols} border-b border-gray-100 last:border-b-0`}
            >
              <div className="sticky left-0 z-10 flex items-center bg-white px-3 py-2 text-sm font-medium text-gray-900">
                {row.employeeName}
              </div>
              {row.cells.map((cell, i) => (
                <div
                  key={days[i].date}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setSel({ rowIdx, dayIdx: i });
                  }}
                  className={`min-h-[3.5rem] cursor-context-menu border-l border-gray-200 p-1.5 ${dayCellClass(
                    days[i].isToday,
                    days[i].isWeekend
                  )}`}
                >
                  {row.absenceCells[i].map((ab, ai) => {
                    const style = absenceStyle(ab.category);
                    return (
                      <div
                        key={`abs-${row.employeeId}-${days[i].date}-${ai}`}
                        className={`mb-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${style.band}`}
                      >
                        {ab.label}
                        {ab.half ? " (½ Tag)" : ""}
                      </div>
                    );
                  })}
                  <div className="flex flex-col gap-1">
                    {cell.map((ev) => (
                      <div
                        key={`${row.employeeId}-${days[i].date}-${ev.id}`}
                        className="rounded-md border border-gray-300 bg-gray-100 p-1.5 shadow-sm"
                        title={ev.projectName ?? ev.title}
                      >
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                          {ev.timeLabel}
                        </p>
                        <p className="mt-0.5 truncate text-xs font-medium leading-snug text-gray-900">
                          {ev.title}
                        </p>
                        {(ev.projectRelativeId != null || ev.projectName) && (
                          <p className="truncate text-[11px] text-gray-500">
                            {ev.projectRelativeId != null && (
                              <span className="font-semibold text-gray-700">
                                #{ev.projectRelativeId}
                              </span>
                            )}
                            {ev.projectRelativeId != null && ev.projectName ? " " : ""}
                            {ev.projectName}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Detail popup (right-click) */}
      {sel && selRow && selDay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setSel(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border border-gray-200 bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{selRow.employeeName}</h3>
                <p className="text-sm text-gray-500">{selDay.label}</p>
              </div>
              <button
                type="button"
                onClick={() => setSel(null)}
                className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                aria-label="Schließen"
              >
                ✕
              </button>
            </div>

            {selAbsences.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {selAbsences.map((ab, ai) => {
                  const style = absenceStyle(ab.category);
                  return (
                    <span
                      key={ai}
                      className={`rounded border px-2 py-0.5 text-xs font-semibold ${style.band}`}
                    >
                      {ab.label}
                      {ab.half ? " (½ Tag)" : ""}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Plan/Ist comparison table, grouped by project */}
            {compareRows.length === 0 ? (
              <p className="text-sm text-gray-400">Keine Plan- oder Ist-Daten an diesem Tag.</p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-1.5 pr-2 font-semibold">Projekt</th>
                    <th className="py-1.5 px-2 text-right font-semibold">Plan</th>
                    <th className="py-1.5 px-2 text-right font-semibold">Ist</th>
                    <th className="py-1.5 pl-2 text-right font-semibold">Diff.</th>
                  </tr>
                </thead>
                <tbody>
                  {compareRows.map((r) => {
                    const diff = r.ist - r.plan;
                    return (
                      <tr key={r.key} className="border-b border-gray-100">
                        <td className="py-1.5 pr-2 text-gray-900">{r.label}</td>
                        <td className="py-1.5 px-2 text-right text-gray-700">{hoursFmt(r.plan)}</td>
                        <td className="py-1.5 px-2 text-right text-emerald-700">{hoursFmt(r.ist)}</td>
                        <td
                          className={`py-1.5 pl-2 text-right font-medium ${
                            diff < 0 ? "text-rose-600" : diff > 0 ? "text-emerald-700" : "text-gray-500"
                          }`}
                        >
                          {diff > 0 ? "+" : ""}
                          {hoursFmt(diff)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300 font-semibold">
                    <td className="py-1.5 pr-2 text-gray-900">Summe</td>
                    <td className="py-1.5 px-2 text-right text-gray-900">{hoursFmt(plannedTotal)}</td>
                    <td className="py-1.5 px-2 text-right text-emerald-700">{hoursFmt(workedTotal)}</td>
                    <td
                      className={`py-1.5 pl-2 text-right ${
                        workedTotal - plannedTotal < 0
                          ? "text-rose-600"
                          : workedTotal - plannedTotal > 0
                            ? "text-emerald-700"
                            : "text-gray-500"
                      }`}
                    >
                      {workedTotal - plannedTotal > 0 ? "+" : ""}
                      {hoursFmt(workedTotal - plannedTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
