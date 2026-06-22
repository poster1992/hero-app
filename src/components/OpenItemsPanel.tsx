"use client";

import { useState } from "react";
import type { MonthlyOpen, OpenDetail } from "@/lib/dashboard-data";

const currencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

function formatDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString("de-DE");
}

interface OpenItem {
  key: "receipts" | "invoices";
  label: string;
  partyLabel: string;
  total: number;
  count: number;
  monthly: MonthlyOpen[];
  details: OpenDetail[];
}

export default function OpenItemsPanel({
  year,
  openReceiptsTotal,
  openReceiptsCount,
  openReceiptsMonthly,
  openReceiptsDetails,
  openInvoicesTotal,
  openInvoicesCount,
  openInvoicesMonthly,
  openInvoicesDetails,
}: {
  year: number;
  openReceiptsTotal: number;
  openReceiptsCount: number;
  openReceiptsMonthly: MonthlyOpen[];
  openReceiptsDetails: OpenDetail[];
  openInvoicesTotal: number;
  openInvoicesCount: number;
  openInvoicesMonthly: MonthlyOpen[];
  openInvoicesDetails: OpenDetail[];
}) {
  const [active, setActive] = useState<OpenItem | null>(null);
  const [month, setMonth] = useState<MonthlyOpen | null>(null);

  const open = (item: OpenItem) => {
    setActive(item);
    setMonth(null);
  };
  const close = () => {
    setActive(null);
    setMonth(null);
  };

  const items: OpenItem[] = [
    {
      key: "invoices",
      label: "Offene Rechnungen",
      partyLabel: "Kunde",
      total: openInvoicesTotal,
      count: openInvoicesCount,
      monthly: openInvoicesMonthly,
      details: openInvoicesDetails,
    },
    {
      key: "receipts",
      label: "Offene Belege",
      partyLabel: "Lieferant",
      total: openReceiptsTotal,
      count: openReceiptsCount,
      monthly: openReceiptsMonthly,
      details: openReceiptsDetails,
    },
  ];

  return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-gray-200 pt-3">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => open(item)}
            className="rounded-lg bg-gray-50 px-3 py-2 text-left transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-red/40"
          >
            <div className="text-xs text-gray-500">{item.label}</div>
            <div className="text-base font-semibold tabular-nums text-gray-900">
              {currencyFormatter.format(item.total)}
            </div>
            <div className="text-xs text-gray-400">
              {item.count} offen · brutto · Details ansehen
            </div>
          </button>
        ))}
      </div>

      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={close}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-gray-300 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-gray-900">
                {month
                  ? `${active.label} – ${month.label} ${year}`
                  : `${active.label} ${year} – nach Monat`}
              </h3>
              <button
                type="button"
                onClick={close}
                className="text-gray-400 transition-colors hover:text-gray-700"
                aria-label="Schließen"
              >
                ✕
              </button>
            </div>

            {active.count === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">
                Keine offenen Posten in diesem Jahr.
              </p>
            ) : month ? (
              /* Detailansicht eines Monats */
              <>
                <button
                  type="button"
                  onClick={() => setMonth(null)}
                  className="mb-3 text-sm text-brand-red hover:underline"
                >
                  ← zurück zur Monatsübersicht
                </button>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-300 text-xs uppercase tracking-wide text-gray-500">
                      <th className="py-2 pr-4 text-left font-medium">Datum</th>
                      <th className="py-2 pr-4 text-left font-medium">Nr.</th>
                      <th className="py-2 pr-4 text-left font-medium">{active.partyLabel}</th>
                      <th className="py-2 pl-4 text-right font-medium">Offen (brutto)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.details
                      .filter((d) => d.month === month.month)
                      .map((d, i) => (
                        <tr key={i} className="border-b border-gray-100">
                          <td className="whitespace-nowrap py-2 pr-4 text-left tabular-nums text-gray-600">
                            {formatDate(d.date)}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-4 text-left tabular-nums text-gray-600">
                            {d.number || "—"}
                          </td>
                          <td className="py-2 pr-4 text-left text-gray-800">{d.party}</td>
                          <td className="whitespace-nowrap py-2 pl-4 text-right font-medium tabular-nums text-gray-900">
                            {currencyFormatter.format(d.amount)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gray-300 font-semibold">
                      <td className="py-2 pr-4 text-left text-gray-700" colSpan={3}>
                        Summe {month.label}
                      </td>
                      <td className="whitespace-nowrap py-2 pl-4 text-right tabular-nums text-brand-red">
                        {currencyFormatter.format(month.total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </>
            ) : (
              /* Monatsübersicht */
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-300 text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-2 text-left font-medium">Monat</th>
                    <th className="py-2 text-right font-medium">Anzahl</th>
                    <th className="py-2 text-right font-medium">Offen (brutto)</th>
                  </tr>
                </thead>
                <tbody>
                  {active.monthly
                    .filter((m) => m.count > 0)
                    .map((m) => (
                      <tr
                        key={m.month}
                        onClick={() => setMonth(m)}
                        className="cursor-pointer border-b border-gray-100 transition-colors hover:bg-gray-50"
                      >
                        <td className="py-2 text-left text-brand-red hover:underline">{m.label}</td>
                        <td className="py-2 text-right tabular-nums text-gray-600">{m.count}</td>
                        <td className="py-2 text-right font-medium tabular-nums text-gray-900">
                          {currencyFormatter.format(m.total)}
                        </td>
                      </tr>
                    ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-300 font-semibold">
                    <td className="py-2 text-left text-gray-700">Summe</td>
                    <td className="py-2 text-right tabular-nums text-gray-700">{active.count}</td>
                    <td className="py-2 text-right tabular-nums text-brand-red">
                      {currencyFormatter.format(active.total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      )}
    </>
  );
}
