import type { Vehicle } from "@/lib/vehicles";

function fmtEur(n: number): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function fmtDate(iso: string): string {
  return iso.split("-").reverse().join(".");
}

/** true, sobald das Fälligkeitsdatum der Restrate erreicht/überschritten ist. */
function isDue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return dueDate <= new Date().toISOString().slice(0, 10);
}

/**
 * Übersicht der aktuell geleasten Fahrzeuge: monatliche Rate und Restrate
 * samt Fälligkeitsdatum. Sobald die Restrate fällig ist, wird die Zeile
 * automatisch grün markiert (kein manuelles Abhaken mehr nötig).
 */
export default function VehicleLeasingTable({ vehicles }: { vehicles: Vehicle[] }) {
  return (
    <div className="overflow-x-auto border border-line bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <th className="px-4 py-2.5">Fahrzeug</th>
            <th className="px-4 py-2.5">Kennzeichen</th>
            <th className="px-4 py-2.5">Monatliche Rate</th>
            <th className="px-4 py-2.5">Restrate</th>
            <th className="px-4 py-2.5">Fällig am</th>
            <th className="px-4 py-2.5">Status</th>
          </tr>
        </thead>
        <tbody>
          {vehicles.map((v) => {
            const due = isDue(v.leasingFinalDueDate);
            return (
              <tr key={v.id} className={`border-b border-gray-100 last:border-0 ${due ? "bg-emerald-50" : ""}`}>
                <td className="px-4 py-2.5 font-medium text-gray-900">{v.name}</td>
                <td className="px-4 py-2.5 text-gray-600">{v.plate ?? "—"}</td>
                <td className="px-4 py-2.5 text-gray-600">{v.leasingRate != null ? fmtEur(v.leasingRate) : "—"}</td>
                <td className="px-4 py-2.5 text-gray-600">
                  {v.leasingFinalRate != null ? fmtEur(v.leasingFinalRate) : "—"}
                </td>
                <td className="px-4 py-2.5 text-gray-600">
                  {v.leasingFinalDueDate ? fmtDate(v.leasingFinalDueDate) : "—"}
                </td>
                <td className="px-4 py-2.5">
                  {v.leasingFinalDueDate ? (
                    <span
                      className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
                        due
                          ? "border-emerald-300 bg-emerald-100 text-emerald-700"
                          : "border-amber-300 bg-amber-50 text-amber-700"
                      }`}
                    >
                      {due ? "✓ Restrate fällig" : "⏳ Läuft noch"}
                    </span>
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
