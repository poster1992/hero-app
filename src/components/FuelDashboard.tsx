"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  runFuelOcr,
  type FuelAnalysis,
  type FuelStatus,
} from "@/app/dashboard/benzin/actions";

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const eur4 = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 4 });
const liters = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

const BAR = "#e8392a";

export default function FuelDashboard({
  analysis,
  status,
}: {
  analysis: FuelAnalysis;
  status: FuelStatus;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(status.done);
  const [cost, setCost] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const remaining = Math.max(0, status.total - done);

  const run = async () => {
    setRunning(true);
    setMsg(null);
    let totalCost = 0;
    try {
      for (let i = 0; i < 50; i++) {
        const res = await runFuelOcr();
        if (res.error) {
          setMsg(res.error);
          break;
        }
        totalCost += res.costEur;
        setDone(res.total - res.remaining);
        setCost(Math.round(totalCost * 10000) / 10000);
        if (res.remaining <= 0 || res.processed === 0) {
          setMsg("Auswertung abgeschlossen.");
          break;
        }
      }
      router.refresh();
    } catch {
      setMsg("Auswertung abgebrochen.");
    } finally {
      setRunning(false);
    }
  };

  const topVehicles = analysis.vehicles.slice(0, 15);
  const vehChartHeight = Math.max(180, topVehicles.length * 30 + 30);

  return (
    <div className="flex flex-col gap-6">
      {/* Auswerten-Leiste */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-300 bg-white p-4 shadow-lg shadow-black/10">
        <span className="text-sm text-gray-700">
          Tankrechnungen ausgewertet: <strong>{done}</strong> / {status.total}
        </span>
        <button
          type="button"
          onClick={run}
          disabled={running || remaining === 0}
          title="Noch nicht ausgewertete Circle-Rechnungen per OCR auslesen"
          className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {running
            ? `Werte aus … (${done}/${status.total})`
            : remaining > 0
              ? `Rechnungen auswerten (${remaining})`
              : "Alle ausgewertet ✓"}
        </button>
        {cost > 0 && <span className="text-xs text-gray-500">OCR-Kosten ca. {eur4.format(cost)}</span>}
        {msg && <span className="text-xs text-gray-500">{msg}</span>}
      </div>

      {analysis.invoiceCount === 0 ? (
        <p className="rounded-xl border border-gray-300 bg-white px-5 py-8 text-center text-sm text-gray-500 shadow-lg shadow-black/10">
          Noch keine Tankrechnungen ausgewertet. Klicke oben auf „Rechnungen auswerten".
        </p>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ["Kosten netto", euro.format(analysis.totalNet)],
              ["Kosten brutto", euro.format(analysis.totalGross)],
              ["Liter gesamt", `${liters.format(analysis.totalLiters)} L`],
              ["Fahrzeuge", String(analysis.vehicles.length)],
            ].map(([label, val]) => (
              <div key={label} className="rounded-xl border border-gray-300 bg-white px-4 py-3 shadow-lg shadow-black/10">
                <div className="text-xs text-gray-500">{label}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{val}</div>
              </div>
            ))}
          </div>

          {/* Kosten je Monat */}
          <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
            <h2 className="mb-4 text-lg font-medium text-gray-900">Tankkosten je Monat (netto)</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={analysis.months} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#6b7280" }} />
                <YAxis tick={{ fontSize: 12, fill: "#6b7280" }} tickFormatter={(v) => `${v} €`} width={60} />
                <Tooltip
                  formatter={(v) => euro.format(Number(v))}
                  labelStyle={{ color: "#111827" }}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Bar dataKey="net" name="Netto" fill={BAR} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Kosten je Fahrzeug */}
          <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
            <h2 className="mb-4 text-lg font-medium text-gray-900">Tankkosten je Fahrzeug (netto)</h2>
            <ResponsiveContainer width="100%" height={vehChartHeight}>
              <BarChart
                data={topVehicles}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 12, fill: "#6b7280" }} tickFormatter={(v) => `${v} €`} />
                <YAxis
                  type="category"
                  dataKey="vehicle"
                  tick={{ fontSize: 12, fill: "#374151" }}
                  width={130}
                />
                <Tooltip
                  formatter={(v) => euro.format(Number(v))}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Bar dataKey="net" name="Netto" fill={BAR} radius={[0, 4, 4, 0]}>
                  {topVehicles.map((_, i) => (
                    <Cell key={i} fill={BAR} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Tabelle je Fahrzeug */}
          <div className="overflow-hidden rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
            <div className="border-b border-gray-200 px-5 py-4">
              <h2 className="text-lg font-medium text-gray-900">Übersicht je Fahrzeug</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-2.5 font-medium">Fahrzeug</th>
                    <th className="px-4 py-2.5 text-right font-medium">Liter</th>
                    <th className="px-4 py-2.5 text-right font-medium">Ø €/L</th>
                    <th className="px-4 py-2.5 text-right font-medium">Netto</th>
                    <th className="px-4 py-2.5 text-right font-medium">Brutto</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.vehicles.map((v) => (
                    <tr key={v.vehicle} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium text-gray-900">{v.vehicle}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{liters.format(v.liters)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                        {v.pricePerL > 0 ? eur4.format(v.pricePerL) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-800">{euro.format(v.net)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{euro.format(v.gross)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 bg-gray-50 font-semibold text-gray-900">
                    <td className="px-4 py-2.5">Summe</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{liters.format(analysis.totalLiters)}</td>
                    <td className="px-4 py-2.5" />
                    <td className="px-4 py-2.5 text-right tabular-nums">{euro.format(analysis.totalNet)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{euro.format(analysis.totalGross)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
