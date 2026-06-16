import type { AbcRow } from "@/lib/invoices";

const currencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

const pctFormatter = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const CLASS_STYLES: Record<"A" | "B" | "C", string> = {
  A: "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/30",
  B: "bg-amber-500/15 text-amber-700 ring-1 ring-amber-500/40",
  C: "bg-gray-400/20 text-gray-700 ring-1 ring-gray-400/40",
};

export default function AbcTable({
  title,
  rows,
  valueLabel,
}: {
  title: string;
  rows: AbcRow[];
  valueLabel: string;
}) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  const counts = { A: 0, B: 0, C: 0 };
  for (const r of rows) counts[r.klasse]++;

  return (
    <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
        <h2 className="text-lg font-medium text-gray-900">{title}</h2>
        <p className="text-sm text-gray-600">
          {rows.length} · A {counts.A} · B {counts.B} · C {counts.C} ·{" "}
          {currencyFormatter.format(total)}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-gray-500">Keine Daten in diesem Jahr.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                <th className="px-5 py-3 font-medium">#</th>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium text-right">{valueLabel}</th>
                <th className="px-5 py-3 font-medium text-right">Anteil</th>
                <th className="px-5 py-3 font-medium text-right">Kumuliert</th>
                <th className="px-5 py-3 font-medium">Klasse</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.name}-${i}`}
                  className="border-b border-gray-200 last:border-0 hover:bg-gray-100"
                >
                  <td className="px-5 py-3 text-gray-500">{i + 1}</td>
                  <td className="px-5 py-3 break-words text-gray-800">{r.name}</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap text-gray-800">
                    {currencyFormatter.format(r.value)}
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap text-gray-600">
                    {pctFormatter.format(r.share)} %
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap text-gray-600">
                    {pctFormatter.format(r.cumulative)} %
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${CLASS_STYLES[r.klasse]}`}
                    >
                      {r.klasse}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
