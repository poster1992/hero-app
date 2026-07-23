"use client";

import { useState, useTransition } from "react";
import {
  evaluateConfirmationsAction,
  type ConfirmationReportState,
} from "@/app/dashboard/cockpit/actions";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const hrs = (n: number) =>
  `${n.toLocaleString("de-DE", { maximumFractionDigits: 1 })} h`;

export default function ConfirmationEvalButton({ defaultYear }: { defaultYear: number }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState<string>(String(defaultYear));
  const [state, setState] = useState<ConfirmationReportState | null>(null);
  const [pending, start] = useTransition();

  const run = () => {
    const y = parseInt(year, 10);
    setState(null);
    start(async () => {
      const res = await evaluateConfirmationsAction(y);
      setState(res);
    });
  };

  const report = state?.report;
  const pct = report && report.confirmationsNet > 0 ? (report.invoicedNet / report.confirmationsNet) * 100 : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Auftragsbestätigungen eines Jahres auswerten: wie viel ist bereits verrechnet?"
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:border-brand-red/50 hover:text-gray-900"
      >
        📊 AB-Auswertung
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-5xl rounded-xl border border-gray-300 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                Auftragsbestätigungen – Verrechnungsstand
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-gray-400 transition-colors hover:text-gray-700"
                aria-label="Schließen"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-sm text-gray-600">Jahr</label>
                <input
                  type="number"
                  value={year}
                  min={2000}
                  max={defaultYear + 1}
                  onChange={(e) => setYear(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && run()}
                  className="w-32 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60"
                />
              </div>
              <button
                type="button"
                onClick={run}
                disabled={pending}
                className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Werte aus …" : "Auswerten"}
              </button>
            </div>

            {state?.error && <p className="mt-4 text-sm text-rose-600">{state.error}</p>}

            {report && (
              <div className="mt-5">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <span className="text-sm text-gray-600">
                    {report.projectCount} Projekte mit AB in {report.year}
                  </span>
                  <span className="text-2xl font-bold tabular-nums text-brand-red">
                    {pct.toLocaleString("de-DE", { maximumFractionDigits: 1 })} % verrechnet
                  </span>
                </div>

                <div className="relative h-5 w-full overflow-hidden rounded-full bg-neutral-300">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${Math.max(0, Math.min(pct, 100))}%` }}
                  />
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <div className="text-xs text-gray-500">Auftragsbestätigungen</div>
                    <div className="font-semibold tabular-nums text-gray-900">{eur.format(report.confirmationsNet)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Davon verrechnet</div>
                    <div className="font-semibold tabular-nums text-brand-red">{eur.format(report.invoicedNet)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Noch offen</div>
                    <div className="font-semibold tabular-nums text-gray-900">{eur.format(report.openNet)}</div>
                  </div>
                </div>

                <p className="mt-3 text-xs text-gray-500">
                  Voll verrechnet: <strong className="text-gray-700">{report.fullyInvoiced}</strong> · teilweise:{" "}
                  <strong className="text-gray-700">{report.partiallyInvoiced}</strong> · noch nicht:{" "}
                  <strong className="text-gray-700">{report.notInvoiced}</strong>
                </p>

                {/* Stunden: kalkuliert (Soll) − abgearbeitet (Ist) = verbleibend (max 0). */}
                <div className="mt-4 grid grid-cols-1 gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm sm:grid-cols-3">
                  <div>
                    <div className="text-xs text-gray-500">Kalkulierte Stunden (Soll)</div>
                    <div className="font-semibold tabular-nums text-gray-900">{hrs(report.plannedHoursTotal)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Abgearbeitet (Ist)</div>
                    <div className="font-semibold tabular-nums text-gray-900">{hrs(report.workedHoursTotal)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Verbleibende Soll-Stunden</div>
                    <div className="font-semibold tabular-nums text-brand-red">{hrs(report.remainingHoursTotal)}</div>
                  </div>
                </div>
                <p className="mt-1 text-xs text-gray-400">
                  Verbleibend = Soll − Ist, mindestens 0 (mehr gearbeitet als geplant ⇒ nur die Soll-Stunden abgezogen).
                </p>

                {report.openProjects.length > 0 && (
                  <div className="mt-5">
                    <h3 className="mb-2 text-sm font-semibold text-gray-900">
                      Noch nicht (voll) verrechnete Aufträge
                    </h3>
                    <div className="max-h-72 overflow-auto rounded-md border border-gray-200">
                      <table className="w-full border-collapse text-sm">
                        <thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                          <tr>
                            <th className="px-3 py-1.5 font-semibold">Nr.</th>
                            <th className="px-3 py-1.5 font-semibold">Projekt / Kunde</th>
                            <th className="px-3 py-1.5 text-right font-semibold">AB</th>
                            <th className="px-3 py-1.5 text-right font-semibold">Verrechnet</th>
                            <th className="px-3 py-1.5 text-right font-semibold">Offen</th>
                            <th className="px-3 py-1.5 text-right font-semibold" title="Kalkulierte Stunden">Soll h</th>
                            <th className="px-3 py-1.5 text-right font-semibold" title="Abgearbeitete Stunden">Ist h</th>
                            <th className="px-3 py-1.5 text-right font-semibold" title="Verbleibende Soll-Stunden = max(Soll − Ist, 0)">Rest h</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.openProjects.map((p) => (
                            <tr key={p.projectId} className="border-t border-gray-100">
                              <td className="px-3 py-1.5 tabular-nums text-gray-500">
                                {p.relativeId != null ? `#${p.relativeId}` : "—"}
                              </td>
                              <td className="px-3 py-1.5 text-gray-900">
                                {p.name}
                                {p.customerName && <span className="text-gray-500"> — {p.customerName}</span>}
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{eur.format(p.confirmationNet)}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{eur.format(p.invoicedNet)}</td>
                              <td className="px-3 py-1.5 text-right font-medium tabular-nums text-gray-900">{eur.format(p.openNet)}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{hrs(p.plannedHours)}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{hrs(p.workedHours)}</td>
                              <td className="px-3 py-1.5 text-right font-medium tabular-nums text-gray-900">{hrs(p.remainingHours)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <p className="mt-3 text-xs text-gray-400">
                  „Verrechnet“ = Rechnungen − Gutschriften − Stornos der Projekte mit AB in {report.year}{" "}
                  (projektbezogen, über alle Zeiten).
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
