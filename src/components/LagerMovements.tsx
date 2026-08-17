import type { StockMovement } from "@/lib/material-types";

const numberFmt = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

function formatDateTime(s: string | null): string {
  if (!s) return "";
  const d = new Date(s.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Buchungs-Historie (eigene Lager-Unterseite): die letzten Ein-/Ausbuchungen. */
export default function LagerMovements({ movements }: { movements: StockMovement[] }) {
  return (
    <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
      <h2 className="mb-3 text-lg font-semibold text-gray-900">Letzte Buchungen</h2>
      {movements.length === 0 ? (
        <p className="text-sm text-gray-400">Noch keine Buchungen.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {movements.map((mv) => (
            <li key={mv.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium text-gray-900">{mv.materialName}</span>
                {mv.projectName ? (
                  <span className="text-gray-500">
                    {" · "}
                    {mv.projectRelativeId != null ? `#${mv.projectRelativeId} ` : ""}
                    {mv.projectName}
                  </span>
                ) : (
                  ""
                )}
                {mv.comment ? <span className="text-gray-500"> · {mv.comment}</span> : ""}
                <span className="block text-xs text-gray-400">
                  {formatDateTime(mv.at)}
                  {mv.employeeName ? ` · ${mv.employeeName}` : mv.byName ? ` · ${mv.byName}` : ""}
                </span>
              </div>
              <span
                className={`shrink-0 font-semibold ${
                  mv.delta >= 0 ? "text-emerald-700" : "text-rose-600"
                }`}
              >
                {mv.delta >= 0 ? "+" : ""}
                {numberFmt.format(mv.delta)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
