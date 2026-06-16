import type { ReceiptsSummary } from "@/lib/invoices";

const currencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

export default function ReceiptsSummaryPanel({ summary }: { summary: ReceiptsSummary }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="grid grid-cols-2 gap-4 lg:col-span-2">
        <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
          <p className="text-sm text-gray-600">Gesamtsumme (Brutto)</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">
            {currencyFormatter.format(summary.grossTotal)}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Netto {currencyFormatter.format(summary.netTotal)} · {summary.count} Belege
          </p>
        </div>
        <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
          <p className="text-sm text-gray-600">Steuerlast</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">
            {currencyFormatter.format(summary.taxTotal)}
          </p>
          <p className="mt-1 text-xs text-gray-500">aus {summary.taxByRate.length} Steuersätzen</p>
        </div>
        <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
          <p className="text-sm text-gray-600">Bezahlt</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-600">
            {currencyFormatter.format(summary.paidTotal)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
          <p className="text-sm text-gray-600">Offen</p>
          <p
            className={`mt-2 text-2xl font-semibold ${
              summary.openTotal > 0.005 ? "text-brand-red" : "text-gray-900"
            }`}
          >
            {currencyFormatter.format(summary.openTotal)}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
        <p className="text-sm font-medium text-gray-700">Steuerlast nach Steuersatz</p>
        {summary.taxByRate.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">Keine Daten</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-500">
                <th className="pb-2 text-left font-medium">Satz</th>
                <th className="pb-2 text-right font-medium">Netto</th>
                <th className="pb-2 text-right font-medium">Steuer</th>
              </tr>
            </thead>
            <tbody>
              {summary.taxByRate.map((r) => (
                <tr key={r.rate} className="border-t border-gray-200">
                  <td className="py-1.5 text-left text-gray-700">{r.rate}&nbsp;%</td>
                  <td className="py-1.5 text-right text-gray-600">
                    {currencyFormatter.format(r.net)}
                  </td>
                  <td className="py-1.5 text-right text-gray-700">
                    {currencyFormatter.format(r.tax)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
