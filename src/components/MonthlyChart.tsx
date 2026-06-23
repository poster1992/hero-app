"use client";

import { useState } from "react";
import {
  Bar,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MonthlyTotals } from "@/lib/dashboard-data";

const currencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const currencyFormatterFull = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

interface TooltipEntry {
  dataKey?: string | number;
  value?: number | string;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const valueOf = (key: string) => {
    const entry = payload.find((p) => p.dataKey === key);
    return entry ? Number(entry.value) : 0;
  };
  const income = valueOf("income");
  const output = valueOf("output");
  const offers = valueOf("offers");
  const confirmations = valueOf("confirmations");
  const surplus = income - output;

  return (
    <div
      style={{
        backgroundColor: "#18181b",
        border: "1px solid #3f3f46",
        borderRadius: 8,
        padding: "8px 12px",
        color: "#e5e7eb",
        fontSize: 13,
      }}
    >
      <p style={{ margin: 0, marginBottom: 6, fontWeight: 600 }}>{label}</p>
      <p style={{ margin: 0, color: "#60a5fa" }}>
        Angebote: {currencyFormatterFull.format(offers)}
      </p>
      <p style={{ margin: 0, color: "#fbbf24" }}>
        Auftragsbestätigungen: {currencyFormatterFull.format(confirmations)}
      </p>
      <div style={{ borderTop: "1px solid #3f3f46", margin: "6px 0" }} />
      <p style={{ margin: 0, color: "#10b981" }}>
        Einnahmen: {currencyFormatterFull.format(income)}
      </p>
      <p style={{ margin: 0, color: "#e8392a" }}>
        Ausgaben: {currencyFormatterFull.format(output)}
      </p>
      <div style={{ borderTop: "1px solid #3f3f46", margin: "6px 0" }} />
      <p style={{ margin: 0, fontWeight: 600, color: surplus >= 0 ? "#10b981" : "#e8392a" }}>
        Überschuss: {currencyFormatterFull.format(surplus)}
      </p>
    </div>
  );
}

/** Least-squares slope/intercept of values over x = 0..n-1. */
function linearFit(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 };
  const sumX = (n * (n - 1)) / 2;
  const sumXX = ((n - 1) * n * (2 * n - 1)) / 6;
  const sumY = values.reduce((s, v) => s + v, 0);
  const sumXY = values.reduce((s, v, i) => s + v * i, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

const TREND_SERIES = ["offers", "confirmations", "income", "output"] as const;

export default function MonthlyChart({
  data,
  avgIncome,
  avgOutput,
  avgOffers,
  avgConfirmations,
  elapsedMonths,
}: {
  data: MonthlyTotals[];
  avgIncome?: number;
  avgOutput?: number;
  avgOffers?: number;
  avgConfirmations?: number;
  elapsedMonths?: number;
}) {
  // Standardmäßig nur Einnahmen + Ausgaben sichtbar (Angebote/Auftragsbestätigungen ausgeblendet).
  const [hidden, setHidden] = useState<Set<string>>(new Set(["offers", "confirmations"]));
  const [showTrend, setShowTrend] = useState(true);
  const [showAvg, setShowAvg] = useState(true);

  // Tendenz (lineare Regression) je Reihe über die abgelaufenen Monate.
  const elapsed = Math.max(0, Math.min(elapsedMonths ?? data.length, data.length));
  const fits = Object.fromEntries(
    TREND_SERIES.map((key) => [
      key,
      linearFit(data.slice(0, elapsed).map((d) => d[key])),
    ])
  ) as Record<(typeof TREND_SERIES)[number], { slope: number; intercept: number }>;

  const chartData = data.map((d, i) => {
    const point: Record<string, number | string | null> = { ...d };
    for (const key of TREND_SERIES) {
      const fit = fits[key];
      point[`${key}Trend`] =
        i < elapsed ? Math.round((fit.intercept + fit.slope * i) * 100) / 100 : null;
    }
    return point;
  });

  const isHidden = (key: string) => hidden.has(key);
  const toggle = (key?: string) => {
    if (!key) return;
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setShowAvg((v) => !v)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            showAvg
              ? "bg-brand-red text-white shadow-[0_0_20px_-6px_rgba(232,57,42,0.8)]"
              : "border border-gray-300 text-gray-600 hover:border-brand-red/50 hover:text-gray-900"
          }`}
        >
          {showAvg ? "Ø-Linien ausblenden" : "Ø-Linien einblenden"}
        </button>
        <button
          type="button"
          onClick={() => setShowTrend((v) => !v)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            showTrend
              ? "bg-brand-red text-white shadow-[0_0_20px_-6px_rgba(232,57,42,0.8)]"
              : "border border-gray-300 text-gray-600 hover:border-brand-red/50 hover:text-gray-900"
          }`}
        >
          {showTrend ? "Tendenzkurven ausblenden" : "Tendenzkurven einblenden"}
        </button>
      </div>
      <ResponsiveContainer width="100%" height={360}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
        <XAxis dataKey="label" stroke="#9ca3af" tick={{ fill: "#374151" }} />
        <YAxis
          stroke="#9ca3af"
          tick={{ fill: "#374151" }}
          tickFormatter={(value: number) => currencyFormatter.format(value)}
        />
        <Tooltip cursor={{ fill: "rgba(0,0,0,0.05)" }} content={<ChartTooltip />} />
        <Legend
          wrapperStyle={{ color: "#374151", cursor: "pointer" }}
          onClick={(o) => toggle(typeof o?.dataKey === "string" ? o.dataKey : undefined)}
          formatter={(value, entry) => {
            const key = (entry as { dataKey?: string })?.dataKey;
            const off = key ? isHidden(key) : false;
            return (
              <span style={{ color: off ? "#9ca3af" : "#374151", textDecoration: off ? "line-through" : "none" }}>
                {value}
              </span>
            );
          }}
        />
        <Bar
          dataKey="offers"
          name="Angebote (netto)"
          fill="#60a5fa"
          radius={[4, 4, 0, 0]}
          hide={isHidden("offers")}
        />
        <Bar
          dataKey="confirmations"
          name="Auftragsbestätigungen (netto)"
          fill="#fbbf24"
          radius={[4, 4, 0, 0]}
          hide={isHidden("confirmations")}
        />
        <Bar
          dataKey="income"
          name="Einnahmen (netto)"
          fill="#10b981"
          radius={[4, 4, 0, 0]}
          hide={isHidden("income")}
        />
        <Bar
          dataKey="output"
          name="Ausgaben (netto)"
          fill="#e8392a"
          radius={[4, 4, 0, 0]}
          hide={isHidden("output")}
        />
        <Line
          type="linear"
          dataKey="offersTrend"
          stroke="#60a5fa"
          strokeWidth={2}
          strokeDasharray="6 4"
          dot={false}
          activeDot={false}
          legendType="none"
          connectNulls
          hide={!showTrend || isHidden("offers")}
        />
        <Line
          type="linear"
          dataKey="confirmationsTrend"
          stroke="#fbbf24"
          strokeWidth={2}
          strokeDasharray="6 4"
          dot={false}
          activeDot={false}
          legendType="none"
          connectNulls
          hide={!showTrend || isHidden("confirmations")}
        />
        <Line
          type="linear"
          dataKey="incomeTrend"
          stroke="#10b981"
          strokeWidth={2}
          strokeDasharray="6 4"
          dot={false}
          activeDot={false}
          legendType="none"
          connectNulls
          hide={!showTrend || isHidden("income")}
        />
        <Line
          type="linear"
          dataKey="outputTrend"
          stroke="#e8392a"
          strokeWidth={2}
          strokeDasharray="6 4"
          dot={false}
          activeDot={false}
          legendType="none"
          connectNulls
          hide={!showTrend || isHidden("output")}
        />
        {avgOffers != null && showAvg && !isHidden("offers") && (
          <ReferenceLine
            y={avgOffers}
            stroke="#60a5fa"
            strokeDasharray="5 5"
            strokeWidth={2}
            label={{
              value: `Ø Angebote ${currencyFormatter.format(avgOffers)}`,
              position: "insideTopRight",
              fill: "#93c5fd",
              fontSize: 11,
            }}
          />
        )}
        {avgConfirmations != null && showAvg && !isHidden("confirmations") && (
          <ReferenceLine
            y={avgConfirmations}
            stroke="#fbbf24"
            strokeDasharray="5 5"
            strokeWidth={2}
            label={{
              value: `Ø Auftragsbestätigungen ${currencyFormatter.format(avgConfirmations)}`,
              position: "insideTopRight",
              fill: "#fcd34d",
              fontSize: 11,
            }}
          />
        )}
        {avgIncome != null && showAvg && !isHidden("income") && (
          <ReferenceLine
            y={avgIncome}
            stroke="#10b981"
            strokeDasharray="5 5"
            strokeWidth={2}
            label={{
              value: `Ø Einnahmen ${currencyFormatter.format(avgIncome)}`,
              position: "insideTopRight",
              fill: "#34d399",
              fontSize: 11,
            }}
          />
        )}
        {avgOutput != null && showAvg && !isHidden("output") && (
          <ReferenceLine
            y={avgOutput}
            stroke="#e8392a"
            strokeDasharray="5 5"
            strokeWidth={2}
            label={{
              value: `Ø Ausgaben ${currencyFormatter.format(avgOutput)}`,
              position: "insideTopRight",
              fill: "#f87171",
              fontSize: 11,
            }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
    </div>
  );
}
