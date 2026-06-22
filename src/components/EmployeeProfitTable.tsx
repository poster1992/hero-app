"use client";

import { useState } from "react";
import type { EmployeeProfitRow } from "@/lib/employee-profit";

const currencyFormatter = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const numberFmt = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

export default function EmployeeProfitTable({ rows }: { rows: EmployeeProfitRow[] }) {
  const [active, setActive] = useState<EmployeeProfitRow | null>(null);
  const maxProfit = Math.max(...rows.map((r) => Math.abs(r.profit)), 1);
  const totalHours = rows.reduce((s, r) => s + r.hours, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalProfit = rows.reduce((s, r) => s + r.profit, 0);
  const totalPerHour = totalHours > 0 ? totalProfit / totalHours : 0;

  return (
    <>
      <table className="w-full border-collapse text-sm">
        <thead className="bg-gray-50">
          <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="px-4 py-2 font-semibold">#</th>
            <th className="px-4 py-2 font-semibold">Mitarbeiter</th>
            <th className="px-4 py-2 text-right font-semibold">Stunden</th>
            <th className="px-4 py-2 text-right font-semibold">Zug. Umsatz</th>
            <th className="px-4 py-2 text-right font-semibold">Gewinn</th>
            <th className="px-4 py-2 text-right font-semibold">Gewinn/Std</th>
            <th className="px-4 py-2 font-semibold">Anteil</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.employeeId}
              onClick={() => setActive(r)}
              className="cursor-pointer border-t border-gray-100 transition-colors hover:bg-gray-50"
            >
              <td className="px-4 py-2 text-gray-400">{i + 1}</td>
              <td className="px-4 py-2 font-medium text-brand-red hover:underline">
                {r.employeeName}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                {numberFmt.format(r.hours)} h
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                {currencyFormatter.format(r.revenue)}
              </td>
              <td
                className={`px-4 py-2 text-right font-semibold tabular-nums ${
                  r.profit < 0 ? "text-brand-red" : "text-emerald-600"
                }`}
              >
                {currencyFormatter.format(r.profit)}
              </td>
              <td
                className={`px-4 py-2 text-right tabular-nums ${
                  r.profitPerHour < 0 ? "text-brand-red" : "text-gray-700"
                }`}
              >
                {currencyFormatter.format(r.profitPerHour)}
              </td>
              <td className="px-4 py-2">
                <div className="h-3 w-32 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full rounded-full ${
                      r.profit < 0 ? "bg-brand-red" : "bg-emerald-500"
                    }`}
                    style={{ width: `${(Math.abs(r.profit) / maxProfit) * 100}%` }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
            <td className="px-4 py-2" />
            <td className="px-4 py-2 text-gray-900">Gesamt</td>
            <td className="px-4 py-2 text-right tabular-nums text-gray-800">
              {numberFmt.format(totalHours)} h
            </td>
            <td className="px-4 py-2 text-right tabular-nums text-gray-800">
              {currencyFormatter.format(totalRevenue)}
            </td>
            <td
              className={`px-4 py-2 text-right tabular-nums ${
                totalProfit < 0 ? "text-brand-red" : "text-emerald-600"
              }`}
            >
              {currencyFormatter.format(totalProfit)}
            </td>
            <td
              className={`px-4 py-2 text-right tabular-nums ${
                totalPerHour < 0 ? "text-brand-red" : "text-gray-700"
              }`}
            >
              {currencyFormatter.format(totalPerHour)}
            </td>
            <td className="px-4 py-2" />
          </tr>
        </tfoot>
      </table>

      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setActive(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-gray-300 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-gray-900">{active.employeeName}</h3>
              <button
                type="button"
                onClick={() => setActive(null)}
                className="text-gray-400 transition-colors hover:text-gray-700"
                aria-label="Schließen"
              >
                ✕
              </button>
            </div>
            <p className="mb-4 text-sm text-gray-600">
              {numberFmt.format(active.hours)} h · Gewinn {currencyFormatter.format(active.profit)} ·
              Zusammensetzung nach Projekten:
            </p>

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-300 text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-4 text-left font-medium">Projekt</th>
                  <th className="py-2 pr-4 text-right font-medium">Std</th>
                  <th className="py-2 pr-4 text-right font-medium">Projektgewinn</th>
                  <th className="py-2 pr-4 text-right font-medium">Anteil</th>
                  <th className="py-2 pl-4 text-right font-medium">Gewinn-Anteil</th>
                </tr>
              </thead>
              <tbody>
                {active.projects.map((p) => (
                  <tr key={p.projectId} className="border-b border-gray-100">
                    <td className="py-2 pr-4 text-left text-gray-800">
                      {p.projectRelativeId != null ? `#${p.projectRelativeId} ` : ""}
                      {p.projectName}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums text-gray-600">
                      {numberFmt.format(p.hours)}
                    </td>
                    <td
                      className={`whitespace-nowrap py-2 pr-4 text-right tabular-nums ${
                        p.projectProfit < 0 ? "text-brand-red" : "text-gray-700"
                      }`}
                    >
                      {currencyFormatter.format(p.projectProfit)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums text-gray-600">
                      {numberFmt.format(p.sharePct)} %
                    </td>
                    <td
                      className={`whitespace-nowrap py-2 pl-4 text-right font-medium tabular-nums ${
                        p.profit < 0 ? "text-brand-red" : "text-emerald-600"
                      }`}
                    >
                      {currencyFormatter.format(p.profit)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-300 font-semibold">
                  <td className="py-2 pr-4 text-left text-gray-700" colSpan={4}>
                    Summe
                  </td>
                  <td className="whitespace-nowrap py-2 pl-4 text-right tabular-nums text-emerald-600">
                    {currencyFormatter.format(active.profit)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
