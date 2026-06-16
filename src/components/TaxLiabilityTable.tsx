import type { MonthlyTotals } from "@/lib/dashboard-data";

const fmt = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function TaxLiabilityTable({
  monthly,
  year,
}: {
  monthly: MonthlyTotals[];
  year: number;
}) {
  const incomeTaxTotal = monthly.reduce((s, m) => s + m.incomeTax, 0);
  const outputTaxTotal = monthly.reduce((s, m) => s + m.outputTax, 0);
  const liabilityTotal = incomeTaxTotal - outputTaxTotal;

  return (
    <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium text-gray-900">Steuerlast {year}</h2>
        <span className="text-xs text-gray-500">Beträge in € (USt / Vorsteuer)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-right text-xs">
          <thead>
            <tr className="border-b border-gray-300 text-xs uppercase tracking-wide text-gray-500">
              <th className="px-2 py-2 text-left font-medium">Kategorie</th>
              {monthly.map((m) => (
                <th key={m.month} className="px-2 py-2 font-medium">
                  {m.label}
                </th>
              ))}
              <th className="px-2 py-2 font-medium text-gray-700">Summe</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-200">
              <td className="whitespace-nowrap px-2 py-2 text-left text-gray-700">
                Ausgangsrechnungen (USt)
              </td>
              {monthly.map((m) => (
                <td key={m.month} className="whitespace-nowrap px-2 py-2 text-gray-700">
                  {fmt.format(m.incomeTax)}
                </td>
              ))}
              <td className="whitespace-nowrap px-2 py-2 font-medium text-gray-900">
                {fmt.format(incomeTaxTotal)}
              </td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="whitespace-nowrap px-2 py-2 text-left text-gray-700">
                Belege (Vorsteuer)
              </td>
              {monthly.map((m) => (
                <td key={m.month} className="whitespace-nowrap px-2 py-2 text-gray-500">
                  {m.outputTax === 0 ? fmt.format(0) : `−${fmt.format(m.outputTax)}`}
                </td>
              ))}
              <td className="whitespace-nowrap px-2 py-2 font-medium text-gray-700">
                {outputTaxTotal === 0 ? fmt.format(0) : `−${fmt.format(outputTaxTotal)}`}
              </td>
            </tr>
            <tr className="border-t border-gray-300 font-semibold text-gray-900">
              <td className="whitespace-nowrap px-2 py-2 text-left">Steuerlast</td>
              {monthly.map((m) => {
                const liability = m.incomeTax - m.outputTax;
                return (
                  <td
                    key={m.month}
                    className={`whitespace-nowrap px-2 py-2 ${
                      liability < 0 ? "text-emerald-600" : "text-gray-900"
                    }`}
                  >
                    {fmt.format(liability)}
                  </td>
                );
              })}
              <td
                className={`whitespace-nowrap px-2 py-2 ${
                  liabilityTotal < 0 ? "text-emerald-600" : "text-gray-900"
                }`}
              >
                {fmt.format(liabilityTotal)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
