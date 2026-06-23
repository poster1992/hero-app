const currencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

export default function InvoicedRatePanel({
  year,
  confirmations,
  invoiced,
}: {
  year: number;
  /** Net sum of order confirmations (Auftragsbestätigungen). */
  confirmations: number;
  /** Net sum already invoiced (Rechnungen − Gutschriften − Stornos). */
  invoiced: number;
}) {
  const pct = confirmations > 0 ? (invoiced / confirmations) * 100 : 0;
  const barWidth = Math.max(0, Math.min(pct, 100));
  const open = Math.max(confirmations - invoiced, 0);

  return (
    <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium text-gray-900">
          Verrechnungsgrad Auftragsbestätigungen {year}
        </h2>
        <span className="text-2xl font-bold tabular-nums text-brand-red">
          {pct.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %
        </span>
      </div>

      {/* Balken: Anteil der bereits verrechneten Auftragsbestätigungen */}
      <div className="relative h-5 w-full overflow-hidden rounded-full bg-neutral-500">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${barWidth}%` }}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div>
          <div className="text-xs text-gray-500">Auftragsbestätigungen</div>
          <div className="font-semibold tabular-nums text-gray-900">
            {currencyFormatter.format(confirmations)}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Davon verrechnet</div>
          <div className="font-semibold tabular-nums text-brand-red">
            {currencyFormatter.format(invoiced)}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Noch offen</div>
          <div className="font-semibold tabular-nums text-gray-900">
            {currencyFormatter.format(open)}
          </div>
        </div>
      </div>
    </div>
  );
}
