"use client";

import { useState } from "react";
import type { StockOutReport, StockOutItem } from "@/lib/materials";

const currencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});
const qtyFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

function formatDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString("de-DE");
}

type Period = "day" | "week" | "month";

const PERIOD_LABEL: Record<Period, string> = {
  day: "Heute",
  week: "Diese Woche",
  month: "Dieser Monat",
};

export default function StockOutPanel({ report }: { report: StockOutReport }) {
  const [period, setPeriod] = useState<Period | null>(null);
  const [compare, setCompare] = useState<"week" | "month" | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const tiles: { key: Period; value: number }[] = [
    { key: "day", value: report.totals.daily },
    { key: "week", value: report.totals.weekly },
    { key: "month", value: report.totals.monthly },
  ];

  const detailItems: StockOutItem[] = period
    ? report.items.filter((i) =>
        period === "day" ? i.isDay : period === "week" ? i.isWeek : i.isMonth
      )
    : [];
  const detailTotal = detailItems.reduce((s, i) => s + i.value, 0);

  const compareData = compare === "week" ? report.weekly : report.monthly;
  const compareMax = Math.max(...compareData.map((d) => d.value), 1);

  const close = () => {
    setPeriod(null);
    setCompare(null);
    setExpanded(null);
  };

  const projectLabel = (p: { projectName: string | null; projectRelativeId: number | null }): string =>
    p.projectName
      ? `${p.projectRelativeId ? `#${p.projectRelativeId} ` : ""}${p.projectName}`
      : p.projectRelativeId
        ? `#${p.projectRelativeId}`
        : "Ohne Projekt";

  return (
    <div className="border border-line bg-white p-5">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Lagerausgang (Warenwert EK)</h2>
        <button
          type="button"
          onClick={() => setCompare("week")}
          className="text-sm text-brand-red hover:underline"
        >
          Vergleich
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setPeriod(t.key)}
            className="rounded-lg bg-gray-50 px-4 py-3 text-left transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-red/40"
          >
            <div className="text-xs text-gray-500">{PERIOD_LABEL[t.key]}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-gray-900">
              {currencyFormatter.format(t.value)}
            </div>
            <div className="mt-0.5 text-xs text-gray-400">Details ansehen</div>
          </button>
        ))}
      </div>

      {/* Detail-Pop-up */}
      {period && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={close}
        >
          <div
            className="max-h-[85vh] w-full max-w-3xl overflow-y-auto border border-line bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-gray-900">
                Lagerausgang – {PERIOD_LABEL[period]}
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

            {detailItems.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">
                Keine Ausbuchungen in diesem Zeitraum.
              </p>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-gray-300 text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-2 pr-4 text-left font-medium">Datum</th>
                    <th className="py-2 pr-4 text-left font-medium">Artikel</th>
                    <th className="py-2 pr-4 text-left font-medium">Projekt</th>
                    <th className="py-2 pr-4 text-left font-medium">Mitarbeiter</th>
                    <th className="py-2 pr-4 text-right font-medium">Menge</th>
                    <th className="py-2 pl-4 text-right font-medium">Wert (EK)</th>
                  </tr>
                </thead>
                <tbody>
                  {detailItems.map((it, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="whitespace-nowrap py-2 pr-4 text-left tabular-nums text-gray-600">
                        {formatDate(it.date)}
                      </td>
                      <td className="py-2 pr-4 text-left text-gray-800">{it.materialName}</td>
                      <td className="py-2 pr-4 text-left text-gray-700">
                        {it.projectName
                          ? `${it.projectRelativeId ? `#${it.projectRelativeId} ` : ""}${it.projectName}`
                          : "—"}
                      </td>
                      <td className="py-2 pr-4 text-left text-gray-700">
                        {it.employeeName || it.byName || "—"}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums text-gray-700">
                        {qtyFormatter.format(it.quantity)} {it.unit}
                      </td>
                      <td className="whitespace-nowrap py-2 pl-4 text-right font-medium tabular-nums text-gray-900">
                        {currencyFormatter.format(it.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-300 font-semibold">
                    <td className="py-2 pr-4 text-left text-gray-700" colSpan={5}>
                      Summe
                    </td>
                    <td className="whitespace-nowrap py-2 pl-4 text-right tabular-nums text-brand-red">
                      {currencyFormatter.format(detailTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Vergleich-Pop-up */}
      {compare && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={close}
        >
          <div
            className="max-h-[85vh] w-full max-w-xl overflow-y-auto border border-line bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-gray-900">Lagerausgang – Vergleich</h3>
              <button
                type="button"
                onClick={close}
                className="text-gray-400 transition-colors hover:text-gray-700"
                aria-label="Schließen"
              >
                ✕
              </button>
            </div>

            <div className="mb-4 flex gap-1.5">
              {(["week", "month"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setCompare(c);
                    setExpanded(null);
                  }}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    compare === c
                      ? "bg-brand-red text-white"
                      : "border border-gray-300 text-gray-600 hover:border-brand-red/50 hover:text-gray-900"
                  }`}
                >
                  {c === "week" ? "Wöchentlich" : "Monatlich"}
                </button>
              ))}
            </div>

            <p className="mb-2 text-xs text-gray-400">Zeitraum anklicken für die Projekte darin.</p>

            <div className="space-y-1.5">
              {compareData.map((d, i) => {
                const isOpen = expanded === d.label;
                return (
                  <div key={i} className="rounded-lg">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : d.label)}
                      disabled={d.value === 0}
                      className="flex w-full items-center gap-3 rounded-md px-1 py-1 text-left transition-colors hover:bg-gray-50 disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <span className="flex w-20 shrink-0 items-center gap-1 text-xs text-gray-600">
                        {d.value > 0 && (
                          <span className={`text-gray-400 transition-transform ${isOpen ? "rotate-90" : ""}`}>▸</span>
                        )}
                        {d.label}
                      </span>
                      <div className="h-4 flex-1 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${(d.value / compareMax) * 100}%` }}
                        />
                      </div>
                      <span className="w-24 shrink-0 text-right text-sm tabular-nums text-gray-900">
                        {currencyFormatter.format(d.value)}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="ml-20 mr-1 mb-1 mt-1 rounded-md border border-gray-200 bg-gray-50/70 px-3 py-2">
                        {d.projects.length === 0 ? (
                          <p className="py-1 text-xs text-gray-500">Keine Projektdaten.</p>
                        ) : (
                          <ul className="divide-y divide-gray-200">
                            {d.projects.map((p, j) => (
                              <li key={j} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                                <span className="min-w-0 truncate text-gray-700">{projectLabel(p)}</span>
                                <span className="shrink-0 tabular-nums font-medium text-gray-900">
                                  {currencyFormatter.format(p.value)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
