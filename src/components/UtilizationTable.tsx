import type { UtilEmployee, UtilizationData } from "@/lib/planning-data";
import { monteurSortKey } from "@/lib/employee-trades";

const hoursFormatter = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

/** Heatmap classes for a cell, based on utilisation (hours / available capacity). */
function cellClasses(planned: number, util: number, absence: number): string {
  if (planned <= 0) return absence > 0 ? "bg-violet-500/15 text-violet-800" : "text-gray-400";
  if (util > 1.0) return "bg-red-500/25 text-red-800 font-semibold";
  if (util >= 0.85) return "bg-emerald-500/20 text-emerald-800";
  if (util >= 0.5) return "bg-amber-500/20 text-amber-800";
  return "bg-sky-500/15 text-sky-800";
}

export default function UtilizationTable({ data }: { data: UtilizationData }) {
  const { weeks, employees, capacityPerWeek } = data;
  const colSpanAll = weeks.length + 2;

  const monteure = employees
    .filter((e) => e.isMonteur)
    .sort((a, b) => {
      const ka = monteurSortKey(a.name);
      const kb = monteurSortKey(b.name);
      return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2], "de");
    });

  function renderEmployeeRow(emp: UtilEmployee) {
    return (
      <tr key={emp.id} className="border-b border-gray-200 hover:bg-gray-100">
        <td className="whitespace-nowrap px-4 py-2 font-medium text-gray-800">
          {emp.name}
          {!emp.countsCapacity && (
            <span className="ml-1 text-[10px] font-normal text-gray-500">(o. Kapazität)</span>
          )}
        </td>
        {emp.perWeek.map((h, i) => {
          const a = emp.absencePerWeek[i];
          const sick = emp.sickPerWeek[i];
          const leave = Math.max(0, a - sick);
          const cap = Math.max(0, capacityPerWeek - a);
          const util = cap > 0 ? h / cap : h > 0 ? 2 : 0;
          // Aushilfen (ohne Kapazität): Stunden zeigen, aber keine %/Heatmap.
          if (!emp.countsCapacity) {
            return (
              <td key={i} className="px-3 py-2 text-center text-gray-800">
                {h > 0 ? <div className="whitespace-nowrap">{hoursFormatter.format(h)} h</div> : "–"}
              </td>
            );
          }
          return (
            <td key={i} className={`px-3 py-2 text-center ${cellClasses(h, util, a)}`}>
              {h > 0 ? (
                <>
                  <div className="whitespace-nowrap">{hoursFormatter.format(h)} h</div>
                  <div className="text-[10px] opacity-70">
                    {cap > 0 ? `${Math.round(util * 100)} %` : "überbucht"}
                  </div>
                  {sick > 0 && (
                    <div className="text-[10px] text-orange-700">
                      −{hoursFormatter.format(sick)} h krank
                    </div>
                  )}
                  {leave > 0 && (
                    <div className="text-[10px] text-violet-700">
                      −{hoursFormatter.format(leave)} h frei
                    </div>
                  )}
                </>
              ) : a > 0 ? (
                <div className="whitespace-nowrap text-[11px]">
                  {sick >= leave
                    ? a >= capacityPerWeek
                      ? "krank"
                      : `${hoursFormatter.format(sick)} h krank`
                    : a >= capacityPerWeek
                      ? "frei"
                      : `${hoursFormatter.format(leave)} h frei`}
                </div>
              ) : (
                "–"
              )}
            </td>
          );
        })}
        <td className="whitespace-nowrap px-4 py-2 text-right font-medium text-gray-900">
          {hoursFormatter.format(emp.total)} h
        </td>
      </tr>
    );
  }

  function renderGroup(label: string, list: UtilEmployee[]) {
    if (list.length === 0) return null;
    const plannedPerWeek = weeks.map((_, i) => list.reduce((s, e) => s + e.perWeek[i], 0));
    // Kapazität & kapazitätsmindernde Abwesenheit nur über Mitarbeiter mit countsCapacity.
    const capMembers = list.filter((e) => e.countsCapacity);
    const absencePerWeek = weeks.map((_, i) =>
      capMembers.reduce((s, e) => s + e.absencePerWeek[i], 0)
    );
    const grandTotal = list.reduce((s, e) => s + e.total, 0);
    return (
      <>
        <tr className="bg-gray-100">
          <td
            colSpan={colSpanAll}
            className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-700"
          >
            {label} · {list.length}
          </td>
        </tr>
        {list.map(renderEmployeeRow)}
        <tr className="border-y border-gray-300 bg-gray-50 text-sm font-semibold text-gray-900">
          <td className="px-4 py-2">Summe {label}</td>
          {plannedPerWeek.map((t, i) => {
            const teamCap = Math.max(0, capacityPerWeek * capMembers.length - absencePerWeek[i]);
            const util = teamCap > 0 ? t / teamCap : 0;
            return (
              <td key={i} className="px-3 py-2 text-center">
                <div className="whitespace-nowrap">{hoursFormatter.format(t)} h</div>
                <div className="text-[10px] font-normal text-gray-600">
                  {Math.round(util * 100)} %
                </div>
              </td>
            );
          })}
          <td className="px-4 py-2 text-right whitespace-nowrap">
            {hoursFormatter.format(grandTotal)} h
          </td>
        </tr>
      </>
    );
  }

  return (
    <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
        <h2 className="text-lg font-medium text-gray-900">Auslastung je Mitarbeiter</h2>
        <p className="text-sm text-gray-600">
          {monteure.length} Monteure · Kapazität {capacityPerWeek} h/Woche (abzgl. Abwesenheit)
        </p>
      </div>

      {monteure.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-gray-500">
          Keine geplanten Termine in diesem Zeitraum.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-700 [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:border-b-2 [&>th]:border-white/10 [&>th]:bg-[#191c20]">
                <th className="px-4 py-3 font-medium">Mitarbeiter</th>
                {weeks.map((w) => (
                  <th key={w.index} className="px-3 py-3 text-center font-medium">
                    {w.label}
                  </th>
                ))}
                <th className="px-4 py-3 text-right font-medium">Summe</th>
              </tr>
            </thead>
            <tbody>
              {renderGroup("Monteure", monteure)}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 border-t border-gray-200 px-5 py-3 text-xs text-gray-600">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-sky-500/40" /> &lt; 50 %
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-amber-500/40" /> 50–85 %
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-emerald-500/40" /> 85–100 %
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-red-500/50" /> &gt; 100 % (überlastet)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-violet-500/40" /> frei (Urlaub/sonstige)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-orange-700">−h krank</span> Krankheit (kürzt Kapazität)
        </span>
      </div>
    </div>
  );
}
