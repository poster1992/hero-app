const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

const currencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

/** Monthly order rate (Auftragsquote = Auftragsbestätigungen / Angebote) as chart + table. */
export default function OrderRateMonthly({
  year,
  offers,
  confirmations,
}: {
  year: number;
  offers: number[];
  confirmations: number[];
}) {
  const quotes = offers.map((o, i) => (o > 0 ? (confirmations[i] / o) * 100 : null));
  const totalOffers = offers.reduce((a, b) => a + b, 0);
  const totalConf = confirmations.reduce((a, b) => a + b, 0);
  const totalQuote = totalOffers > 0 ? (totalConf / totalOffers) * 100 : null;
  const fmtPct = (q: number | null) =>
    q == null ? "—" : `${q.toLocaleString("de-DE", { maximumFractionDigits: 0 })} %`;

  return (
    <div>
      <h2 className="mb-4 text-lg font-medium text-gray-900">Auftragsquote pro Monat {year}</h2>

      {/* Tabelle: Monate waagerecht, Kennzahlen senkrecht */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] table-fixed border-collapse text-xs">
          <thead className="bg-gray-50">
            <tr className="text-xs uppercase tracking-wide text-gray-500">
              <th className="sticky left-0 bg-gray-50 px-2 py-2 text-left font-semibold">Kennzahl</th>
              {MONTHS.map((m) => (
                <th key={m} className="px-2 py-2 text-right font-semibold">
                  {m}
                </th>
              ))}
              <th className="px-2 py-2 text-right font-semibold">Gesamt</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-gray-100">
              <th className="sticky left-0 bg-white px-2 py-1.5 text-left font-medium text-gray-900">
                Angebote
              </th>
              {offers.map((v, i) => (
                <td key={i} className="px-2 py-1.5 text-right tabular-nums text-gray-700">
                  {currencyFormatter.format(v)}
                </td>
              ))}
              <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-gray-900">
                {currencyFormatter.format(totalOffers)}
              </td>
            </tr>
            <tr className="border-t border-gray-100">
              <th className="sticky left-0 bg-white px-2 py-1.5 text-left font-medium text-gray-900">
                Aufträge
              </th>
              {confirmations.map((v, i) => (
                <td key={i} className="px-2 py-1.5 text-right tabular-nums text-gray-700">
                  {currencyFormatter.format(v)}
                </td>
              ))}
              <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-gray-900">
                {currencyFormatter.format(totalConf)}
              </td>
            </tr>
            <tr className="border-t border-gray-100">
              <th className="sticky left-0 bg-white px-2 py-1.5 text-left font-medium text-gray-900">
                Quote
              </th>
              {quotes.map((q, i) => (
                <td key={i} className="px-2 py-1.5 text-right font-medium tabular-nums text-brand-red">
                  {fmtPct(q)}
                </td>
              ))}
              <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-brand-red">
                {fmtPct(totalQuote)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
