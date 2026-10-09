"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setLeasingMonthPaidAction, setLeasingFinalPaidAction } from "@/app/dashboard/fahrzeug-leasing/actions";
import type { Vehicle, VehicleLeasingMonth } from "@/lib/vehicles";

function fmtEur(n: number): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function fmtDate(iso: string | null): string {
  return iso ? iso.split("-").reverse().join(".") : "";
}

/**
 * Liste der geleasten Fahrzeuge für einen Monat: monatliche Rate, Bezahlt/
 * Läuft-noch-Status (je Fahrzeug + Monat, über die Toolbar oben navigierbar
 * zu anderen Monaten/Jahren) sowie die einmalige Restrate nach Laufzeitende.
 */
export default function VehicleLeasingTable({
  vehicles,
  statusByVehicle,
  year,
  month,
}: {
  vehicles: Vehicle[];
  statusByVehicle: Record<number, VehicleLeasingMonth>;
  year: number;
  month: number;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);

  const toggleMonth = async (vehicleId: number, currentlyPaid: boolean) => {
    setBusyId(vehicleId);
    await setLeasingMonthPaidAction(vehicleId, year, month, !currentlyPaid);
    setBusyId(null);
    router.refresh();
  };

  const toggleFinal = async (vehicleId: number, currentlyPaid: boolean) => {
    setBusyId(vehicleId);
    await setLeasingFinalPaidAction(vehicleId, !currentlyPaid);
    setBusyId(null);
    router.refresh();
  };

  return (
    <div className="overflow-x-auto border border-line bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <th className="px-4 py-2.5">Fahrzeug</th>
            <th className="px-4 py-2.5">Kennzeichen</th>
            <th className="px-4 py-2.5">Monatliche Rate</th>
            <th className="px-4 py-2.5">Status diesen Monat</th>
            <th className="px-4 py-2.5">Restrate</th>
          </tr>
        </thead>
        <tbody>
          {vehicles.map((v) => {
            const status = statusByVehicle[v.id];
            const paid = status?.paid ?? false;
            const busy = busyId === v.id;
            return (
              <tr key={v.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-2.5 font-medium text-gray-900">{v.name}</td>
                <td className="px-4 py-2.5 text-gray-600">{v.plate ?? "—"}</td>
                <td className="px-4 py-2.5 text-gray-600">{v.leasingRate != null ? fmtEur(v.leasingRate) : "—"}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleMonth(v.id, paid)}
                      disabled={busy}
                      className={`rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                        paid
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                      }`}
                    >
                      {busy ? "…" : paid ? "✓ Bezahlt" : "⏳ Läuft noch"}
                    </button>
                    {paid && status?.paidDate && (
                      <span className="text-xs text-gray-400">
                        seit {fmtDate(status.paidDate)}
                        {status.paidByName ? ` · ${status.paidByName}` : ""}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  {v.leasingFinalRate != null ? (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-600">{fmtEur(v.leasingFinalRate)}</span>
                      <button
                        type="button"
                        onClick={() => toggleFinal(v.id, v.leasingFinalPaid)}
                        disabled={busy}
                        className={`rounded-md border px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${
                          v.leasingFinalPaid
                            ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            : "border-gray-300 text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        {v.leasingFinalPaid ? "✓ Bezahlt" : "Als bezahlt markieren"}
                      </button>
                      {v.leasingFinalPaid && v.leasingFinalPaidDate && (
                        <span className="text-xs text-gray-400">am {fmtDate(v.leasingFinalPaidDate)}</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
