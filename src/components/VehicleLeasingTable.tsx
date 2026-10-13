import { isLeasingDue, type Vehicle } from "@/lib/vehicles";

function fmtEur(n: number): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function fmtDate(iso: string): string {
  return iso.split("-").reverse().join(".");
}

const isDue = isLeasingDue;

/** Anzahl vollständiger Monate zwischen zwei Daten (0, falls `to` vor `from` liegt oder eines fehlt). */
function monthsBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (end < start) return 0;
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
  if (end.getUTCDate() < start.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

interface LeasingSummary {
  /** Bereits bezahlter Betrag (abgelaufene Monatsraten + fällige Restrate). */
  paid: number;
  /** Gesamter Vertragswert (alle Monatsraten der Laufzeit + Restrate) – nur wenn Laufzeit bekannt. */
  total: number | null;
  /**
   * Noch offene Kapitalschuld (vergleichbar mit dem „CRD" der Bank) – fällt
   * linear vom Kaufpreis auf die Restrate, nach deren Zahlung auf 0. Das ist
   * NICHT dasselbe wie „Vertragswert minus Bezahlt" (das würde noch alle
   * künftigen Zinsen mit einrechnen) – nur mit hinterlegtem Kaufpreis bekannt.
   */
  remaining: number | null;
  pct: number | null;
  /** Bereits gezahlter Zinsanteil – nur wenn Laufzeit UND Kaufpreis bekannt. */
  interestPaid: number | null;
}

/**
 * Schätzung auf Basis des tatsächlichen Vertragswerts (alle Monatsraten der
 * Laufzeit + Restrate), NICHT des Kaufpreises – der Kaufpreis ist niedriger,
 * weil im Gesamtvertragswert noch die Zinsen der Bank enthalten sind. Die
 * Vertragslaufzeit wird aus Leasingbeginn bis Fälligkeitsdatum der Restrate
 * abgeleitet; ohne beide Daten lässt sich nur der bisher bezahlte Betrag
 * zeigen, aber keine Gesamtsumme/Restschuld/Zinsen.
 *
 * Zins- und Kapitalanteil (Nutzervorgabe, gegen eine echte Leasingabrechnung
 * geprüft): Kaufpreis fällt linear bis zur Restrate (Restwert) über die
 * Laufzeit ab → Tilgungsanteil/Monat = (Kaufpreis − Restrate) / Laufzeit.
 * Monatliche Rate abzüglich dieses Tilgungsanteils ergibt den Zinsanteil/
 * Monat. „Noch offen" ist die noch offene Kapitalschuld nach diesem Modell
 * (Kaufpreis − bisher getilgter Anteil), NICHT die Summe aller künftigen
 * Monatsraten (die würde zusätzlich noch nicht fällige Zinsen enthalten).
 * Da kein echter Zinssatz/Tilgungsplan der Bank hinterlegt ist, bleibt das
 * eine Näherung, keine exakte Abrechnung.
 */
function leasingSummary(v: Vehicle): LeasingSummary | null {
  if (v.leasingRate == null) return null;
  const due = isDue(v.leasingFinalDueDate);
  const elapsed = monthsBetween(v.leasingStartDate, new Date().toISOString().slice(0, 10)) ?? 0;
  const termMonths = monthsBetween(v.leasingStartDate, v.leasingFinalDueDate);
  const paidMonths = termMonths != null ? Math.min(elapsed, termMonths) : elapsed;
  const finalRate = v.leasingFinalRate ?? 0;
  let paid = paidMonths * v.leasingRate;
  if (due && v.leasingFinalRate != null) paid += finalRate;

  if (termMonths == null) return { paid, total: null, remaining: null, pct: null, interestPaid: null };

  const total = termMonths * v.leasingRate + finalRate;
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : null;

  let interestPaid: number | null = null;
  let remaining: number | null = null;
  if (v.purchasePrice != null && termMonths > 0) {
    const principalPerMonth = (v.purchasePrice - finalRate) / termMonths;
    const interestPerMonth = v.leasingRate - principalPerMonth;
    interestPaid = interestPerMonth * paidMonths;
    remaining = due ? 0 : Math.max(0, v.purchasePrice - principalPerMonth * paidMonths);
  }

  return { paid, total, remaining, pct, interestPaid };
}

/**
 * Übersicht der aktuell geleasten Fahrzeuge: monatliche Rate und Restrate
 * samt Fälligkeitsdatum. Sobald die Restrate fällig ist, wird die Zeile
 * automatisch grün markiert (kein manuelles Abhaken mehr nötig). Bei
 * hinterlegtem Leasingbeginn + Fälligkeitsdatum (= Vertragslaufzeit) wird
 * zusätzlich geschätzt, wie viel bereits bezahlt wurde, wie viel davon
 * Zinsanteil ist (nur mit zusätzlich hinterlegtem Kaufpreis) und wie viel
 * bis Vertragsende noch offen ist.
 */
export default function VehicleLeasingTable({ vehicles }: { vehicles: Vehicle[] }) {
  const running = vehicles.filter((v) => !isDue(v.leasingFinalDueDate));
  const runningSum = running.reduce((sum, v) => sum + (v.leasingRate ?? 0), 0);

  return (
    <div className="overflow-x-auto border border-line bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="whitespace-nowrap border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <th className="px-4 py-2.5">Fahrzeug</th>
            <th className="px-4 py-2.5">Kennzeichen</th>
            <th className="px-4 py-2.5">Monatliche Rate</th>
            <th className="px-4 py-2.5">Restrate</th>
            <th className="px-4 py-2.5">Fällig am</th>
            <th className="px-4 py-2.5">Kaufpreis</th>
            <th className="px-4 py-2.5">Bezahlt</th>
            <th className="px-4 py-2.5">davon Zinsen</th>
            <th className="px-4 py-2.5">Noch offen</th>
            <th className="px-4 py-2.5">Status</th>
          </tr>
        </thead>
        <tbody>
          {vehicles.map((v) => {
            const due = isDue(v.leasingFinalDueDate);
            const summary = leasingSummary(v);
            return (
              <tr
                key={v.id}
                className={`whitespace-nowrap border-b border-gray-100 last:border-0 ${due ? "bg-emerald-50" : ""}`}
              >
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
                  {summary ? (
                    <>
                      {fmtEur(summary.paid)}
                      {summary.pct != null && <span className="ml-1 text-xs text-gray-400">({summary.pct} %)</span>}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-2.5 text-gray-600">
                  {summary?.interestPaid != null ? fmtEur(summary.interestPaid) : "—"}
                </td>
                <td className="px-4 py-2.5 text-gray-600">
                  {summary?.remaining != null ? fmtEur(summary.remaining) : "—"}
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
          <tr className="whitespace-nowrap border-t-2 border-gray-200 bg-gray-50 font-semibold text-gray-900">
            <td className="px-4 py-2.5" colSpan={2}>
              Summe laufende Leasing-Fahrzeuge ({running.length})
            </td>
            <td className="px-4 py-2.5">{fmtEur(runningSum)}</td>
            <td className="px-4 py-2.5" colSpan={7} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
