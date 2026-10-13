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

/** Anzahl vollständig abgelaufener Monate seit Leasingbeginn (0, falls kein/zukünftiges Datum). */
function monthsPaid(startDate: string | null): number {
  if (!startDate) return 0;
  const start = new Date(`${startDate}T00:00:00Z`);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (today < start) return 0;
  let months = (today.getUTCFullYear() - start.getUTCFullYear()) * 12 + (today.getUTCMonth() - start.getUTCMonth());
  if (today.getUTCDate() < start.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Grobe Schätzung des bereits bezahlten Betrags: abgelaufene Monate × Monatsrate,
 * plus Restrate sobald deren Fälligkeitsdatum erreicht ist – gedeckelt auf den
 * Kaufpreis, falls hinterlegt. Keine exakte Abrechnung, sondern eine Orientierung.
 */
function paidAmount(v: Vehicle): number | null {
  if (v.leasingRate == null) return null;
  let paid = monthsPaid(v.leasingStartDate) * v.leasingRate;
  if (isDue(v.leasingFinalDueDate) && v.leasingFinalRate != null) paid += v.leasingFinalRate;
  if (v.purchasePrice != null) paid = Math.min(paid, v.purchasePrice);
  return paid;
}

/**
 * Übersicht der aktuell geleasten Fahrzeuge: monatliche Rate und Restrate
 * samt Fälligkeitsdatum. Sobald die Restrate fällig ist, wird die Zeile
 * automatisch grün markiert (kein manuelles Abhaken mehr nötig). Bei
 * hinterlegtem Kaufpreis + Leasingbeginn wird zusätzlich geschätzt, wie viel
 * vom Fahrzeug bereits bezahlt wurde.
 */
export default function VehicleLeasingTable({ vehicles }: { vehicles: Vehicle[] }) {
  const running = vehicles.filter((v) => !isDue(v.leasingFinalDueDate));
  const runningSum = running.reduce((sum, v) => sum + (v.leasingRate ?? 0), 0);

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
            <th className="px-4 py-2.5">Kaufpreis</th>
            <th className="px-4 py-2.5">Bezahlt</th>
            <th className="px-4 py-2.5">Status</th>
          </tr>
        </thead>
        <tbody>
          {vehicles.map((v) => {
            const due = isDue(v.leasingFinalDueDate);
            const paid = paidAmount(v);
            const pct = paid != null && v.purchasePrice ? Math.min(100, Math.round((paid / v.purchasePrice) * 100)) : null;
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
                <td className="px-4 py-2.5 text-gray-600">{v.purchasePrice != null ? fmtEur(v.purchasePrice) : "—"}</td>
                <td className="px-4 py-2.5 text-gray-600">
                  {paid != null ? (
                    <>
                      {fmtEur(paid)}
                      {pct != null && <span className="ml-1 text-xs text-gray-400">({pct} %)</span>}
                    </>
                  ) : (
                    "—"
                  )}
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
        <tfoot>
          <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-gray-900">
            <td className="px-4 py-2.5" colSpan={2}>
              Summe laufende Leasing-Fahrzeuge ({running.length})
            </td>
            <td className="px-4 py-2.5">{fmtEur(runningSum)}</td>
            <td className="px-4 py-2.5" colSpan={5} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
