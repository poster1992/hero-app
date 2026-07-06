"use client";

import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BaustellenBelegeStats } from "@/lib/baustellen-belege";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const eur0 = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

// Farbpalette für die Lieferanten-Balken (markenrot + abgestufte Töne).
const COLORS = ["#e8392a", "#f0714f", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#64748b", "#94a3b8"];

export default function BaustellenBelegeStats({ stats }: { stats: BaustellenBelegeStats }) {
  const supplierData = stats.bySupplier.slice(0, 8).map((s, i) => ({
    name: s.supplier.length > 18 ? s.supplier.slice(0, 17) + "…" : s.supplier,
    fullName: s.supplier,
    amount: s.amount,
    count: s.count,
    fill: COLORS[i % COLORS.length],
  }));
  const payData = [
    { name: "Bezahlt", value: stats.paidTotal, fill: "#10b981" },
    { name: "Offen", value: stats.openTotal, fill: "#e8392a" },
  ].filter((d) => d.value > 0);

  if (stats.count === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* Kennzahlen */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card label="Gesamtkosten" value={eur.format(stats.total)} />
        <Card label="Belege" value={String(stats.count)} />
        <Card label="Bezahlt" value={eur.format(stats.paidTotal)} accent="text-emerald-600" />
        <Card label="Offen" value={eur.format(stats.openTotal)} accent="text-brand-red" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Kosten nach Lieferant – Diagramm */}
        <div className="rounded-xl border border-gray-300 bg-white p-4 shadow-lg shadow-black/10 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold text-gray-900">Kosten nach Lieferant</h3>
          {supplierData.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">Noch keine Beträge erkannt.</p>
          ) : (
            <div style={{ width: "100%", height: Math.max(160, supplierData.length * 38) }}>
              <ResponsiveContainer>
                <BarChart data={supplierData} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <XAxis type="number" tickFormatter={(v) => eur0.format(v as number)} tick={{ fontSize: 11, fill: "#9aa1ab" }} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: "#d1d5db" }} />
                  <Tooltip
                    formatter={(v) => eur.format(Number(v))}
                    labelFormatter={(_, p) => (p?.[0]?.payload?.fullName as string) ?? ""}
                    contentStyle={{ background: "#1b1e24", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, color: "#f3f4f6" }}
                  />
                  <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
                    {supplierData.map((d, i) => (
                      <Cell key={i} fill={d.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Bezahlstatus – Diagramm */}
        <div className="rounded-xl border border-gray-300 bg-white p-4 shadow-lg shadow-black/10">
          <h3 className="mb-3 text-sm font-semibold text-gray-900">Bezahlstatus</h3>
          {payData.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">Keine Beträge.</p>
          ) : (
            <div style={{ width: "100%", height: 200 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={payData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {payData.map((d, i) => (
                      <Cell key={i} fill={d.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v) => eur.format(Number(v))}
                    contentStyle={{ background: "#1b1e24", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, color: "#f3f4f6" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="mt-1 flex justify-center gap-4 text-xs">
            <span className="flex items-center gap-1 text-gray-600"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Bezahlt</span>
            <span className="flex items-center gap-1 text-gray-600"><span className="h-2 w-2 rounded-full bg-brand-red" /> Offen</span>
          </div>
        </div>
      </div>

      {/* Kosten nach Lieferanten – Liste */}
      <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        <div className="border-b border-gray-200 px-5 py-3">
          <h3 className="text-sm font-semibold text-gray-900">Kosten nach Lieferanten</h3>
        </div>
        <ul className="divide-y divide-gray-100">
          {stats.bySupplier.map((s) => (
            <li key={s.supplier} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-gray-900">{s.supplier}</span>
              <span className="text-xs text-gray-500">{s.count} Beleg(e)</span>
              <span className="w-28 text-right font-medium tabular-nums text-gray-900">{eur.format(s.amount)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Card({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-300 bg-white p-4 shadow-lg shadow-black/10">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${accent ?? "text-gray-900"}`}>{value}</p>
    </div>
  );
}
