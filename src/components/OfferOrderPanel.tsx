"use client";

import { useState } from "react";
import OrderRateMonthly from "./OrderRateMonthly";

const currencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

export default function OfferOrderPanel({
  year,
  offers,
  confirmations,
  monthlyOffers,
  monthlyConfirmations,
}: {
  year: number;
  offers: number;
  confirmations: number;
  monthlyOffers: number[] | null;
  monthlyConfirmations: number[] | null;
}) {
  const [open, setOpen] = useState(false);
  const maxV = Math.max(offers, confirmations, 1);
  const pctV = (v: number) => `${(Math.abs(v) / maxV) * 100}%`;
  const quote = offers > 0 ? Math.round((confirmations / offers) * 100) : null;
  const hasMonthly = !!(monthlyOffers && monthlyConfirmations);

  const rows = [
    { label: "Angebotsvolumen", value: offers, color: "bg-neutral-400" },
    { label: "Auftragsbestätigungen", value: confirmations, color: "bg-brand-red" },
  ];

  return (
    <>
      <div
        onClick={() => hasMonthly && setOpen(true)}
        className={`rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10 ${
          hasMonthly ? "cursor-pointer transition-colors hover:border-brand-red/50" : ""
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900">Angebote &amp; Aufträge {year}</h2>
          {hasMonthly && <span className="text-xs text-gray-400">Monatsdetails →</span>}
        </div>

        <div className="flex flex-col gap-4">
          {rows.map((row) => (
            <div key={row.label}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-gray-600">{row.label}</span>
                <span className="font-medium tabular-nums text-gray-900">
                  {currencyFormatter.format(row.value)}
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
                <div className={`h-full rounded-full ${row.color}`} style={{ width: pctV(row.value) }} />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-baseline justify-between border-t border-gray-200 pt-3 text-sm">
          <span className="text-gray-600">
            Auftragsquote
            <span className="block text-xs text-gray-400">Aufträge im Verhältnis zu Angeboten</span>
          </span>
          <span className="text-lg font-bold tabular-nums text-brand-red">
            {quote == null ? "—" : `${quote} %`}
          </span>
        </div>
      </div>

      {open && hasMonthly && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-800/90 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-[96vw] max-w-[1600px] rounded-xl border border-gray-200 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Angebote &amp; Aufträge {year}</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Schließen"
              >
                ✕
              </button>
            </div>
            <OrderRateMonthly
              year={year}
              offers={monthlyOffers!}
              confirmations={monthlyConfirmations!}
            />
          </div>
        </div>
      )}
    </>
  );
}
