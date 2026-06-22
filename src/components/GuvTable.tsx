import type { GuvData } from "@/lib/dashboard-data";

const MONTH_LABELS = [
  "Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
  "Jul", "Aug", "Sep", "Okt", "Nov", "Dez",
];

const fmt = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format a positive expense as a negative figure ("−1.234,56"), zero as "0,00". */
function neg(value: number): string {
  return value === 0 ? fmt.format(0) : `−${fmt.format(value)}`;
}

export default function GuvTable({ guv, year }: { guv: GuvData; year: number }) {
  return (
    <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium text-gray-900">Gewinn- und Verlustrechnung {year}</h2>
        <span className="text-xs text-gray-500">Beträge netto in €, nach Buchungskonto</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-right text-xs">
          <thead>
            <tr className="border-b border-gray-300 text-xs uppercase tracking-wide text-gray-500">
              <th className="px-2 py-2 text-left font-medium">Konto-Nr.</th>
              <th className="px-2 py-2 text-left font-medium">Position</th>
              {MONTH_LABELS.map((m) => (
                <th key={m} className="px-2 py-2 font-medium">
                  {m}
                </th>
              ))}
              <th className="px-2 py-2 font-medium text-gray-700">Summe</th>
            </tr>
          </thead>
          <tbody>
            {/* Revenue */}
            <tr className="border-b border-gray-200">
              <td
                colSpan={2}
                className="whitespace-nowrap px-2 py-2 text-left font-medium text-gray-700"
              >
                Umsatzerlöse (Rechnungen)
              </td>
              {guv.revenueMonthly.map((v, i) => (
                <td key={i} className="whitespace-nowrap px-2 py-2 text-gray-700">
                  {fmt.format(v)}
                </td>
              ))}
              <td className="whitespace-nowrap px-2 py-2 font-medium text-gray-900">
                {fmt.format(guv.revenueTotal)}
              </td>
            </tr>

            {/* Expenses heading */}
            <tr>
              <td
                colSpan={15}
                className="px-2 pt-3 pb-1 text-left text-[11px] uppercase tracking-wide text-gray-500"
              >
                Aufwendungen nach Buchungskonto
              </td>
            </tr>

            {guv.expenseAccounts.length === 0 ? (
              <tr>
                <td colSpan={15} className="px-2 py-2 text-left text-gray-500">
                  Keine Buchungskonten
                </td>
              </tr>
            ) : (
              guv.expenseAccounts.map((acc) => (
                <tr key={`${acc.accountNumber}-${acc.accountName}`} className="border-b border-gray-200">
                  <td className="whitespace-nowrap px-2 py-2 text-left font-medium tabular-nums text-gray-600">
                    {acc.accountNumber || "—"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-left text-gray-700">
                    {acc.accountName}
                  </td>
                  {acc.monthly.map((v, i) => (
                    <td key={i} className="whitespace-nowrap px-2 py-2 text-gray-500">
                      {neg(v)}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-2 py-2 font-medium text-gray-700">
                    {neg(acc.total)}
                  </td>
                </tr>
              ))
            )}

            {/* Sum of expenses */}
            <tr className="border-b border-gray-300">
              <td
                colSpan={2}
                className="whitespace-nowrap px-2 py-2 text-left font-medium text-gray-700"
              >
                Summe Aufwand
              </td>
              {guv.expenseMonthly.map((v, i) => (
                <td key={i} className="whitespace-nowrap px-2 py-2 font-medium text-gray-700">
                  {neg(v)}
                </td>
              ))}
              <td className="whitespace-nowrap px-2 py-2 font-medium text-gray-900">
                {neg(guv.expenseTotal)}
              </td>
            </tr>

            {/* Result */}
            <tr className="border-t border-gray-300 font-semibold text-gray-900">
              <td colSpan={2} className="whitespace-nowrap px-2 py-2 text-left">
                Ergebnis
              </td>
              {guv.resultMonthly.map((v, i) => (
                <td
                  key={i}
                  className={`whitespace-nowrap px-2 py-2 ${
                    v < 0 ? "text-brand-red" : "text-emerald-600"
                  }`}
                >
                  {fmt.format(v)}
                </td>
              ))}
              <td
                className={`whitespace-nowrap px-2 py-2 ${
                  guv.resultTotal < 0 ? "text-brand-red" : "text-emerald-600"
                }`}
              >
                {fmt.format(guv.resultTotal)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
