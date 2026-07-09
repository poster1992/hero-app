"use client";

import { useState } from "react";
import type { GuvData, GuvAccountRow } from "@/lib/dashboard-data";

const MONTH_LABELS = [
  "Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
  "Jul", "Aug", "Sep", "Okt", "Nov", "Dez",
];
const MONTH_LONG = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

const fmt = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format a positive expense as a negative figure ("−1.234,56"), zero as "0,00". */
function neg(value: number): string {
  return value === 0 ? fmt.format(0) : `−${fmt.format(value)}`;
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return day && m && y ? `${day}.${m}.${y}` : d;
}

/** Ziel des Detail-Popups: ein Konto, optional auf einen Monat gefiltert. */
type Detail = { acc: GuvAccountRow; month: number | null };

export default function GuvTable({ guv, year }: { guv: GuvData; year: number }) {
  const [detail, setDetail] = useState<Detail | null>(null);

  const cellBtn =
    "w-full rounded px-1 text-right tabular-nums transition-colors hover:bg-brand-red/10 hover:text-gray-900";

  return (
    <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium text-gray-900">Gewinn- und Verlustrechnung {year}</h2>
        <span className="text-xs text-gray-500">
          Beträge netto in €, nach Buchungskonto · Wert anklicken für Belege
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-right text-xs">
          <thead>
            <tr className="border-b border-gray-300 text-xs uppercase tracking-wide text-gray-500">
              <th className="px-2 py-2 text-left font-medium">Konto-Nr.</th>
              <th className="px-2 py-2 text-left font-medium">Position</th>
              {MONTH_LABELS.map((m) => (
                <th key={m} className="px-2 py-2 font-medium">
                  {m}
                </th>
              ))}
              <th className="px-2 py-2 font-medium text-gray-700">Summe</th>
            </tr>
          </thead>
          <tbody>
            {/* Revenue */}
            <tr className="border-b border-gray-200">
              <td
                colSpan={2}
                className="whitespace-nowrap px-2 py-2 text-left font-medium text-gray-700"
              >
                Umsatzerlöse (Rechnungen)
              </td>
              {guv.revenueMonthly.map((v, i) => (
                <td key={i} className="whitespace-nowrap px-2 py-2 text-gray-700">
                  {fmt.format(v)}
                </td>
              ))}
              <td className="whitespace-nowrap px-2 py-2 font-medium text-gray-900">
                {fmt.format(guv.revenueTotal)}
              </td>
            </tr>

            {/* Expenses heading */}
            <tr>
              <td
                colSpan={15}
                className="px-2 pt-3 pb-1 text-left text-[11px] uppercase tracking-wide text-gray-500"
              >
                Aufwendungen nach Buchungskonto
              </td>
            </tr>

            {guv.expenseAccounts.length === 0 ? (
              <tr>
                <td colSpan={15} className="px-2 py-2 text-left text-gray-500">
                  Keine Buchungskonten
                </td>
              </tr>
            ) : (
              guv.expenseAccounts.map((acc) => (
                <tr key={`${acc.accountNumber}-${acc.accountName}`} className="border-b border-gray-200">
                  <td className="whitespace-nowrap px-2 py-2 text-left font-medium tabular-nums text-gray-600">
                    {acc.accountNumber || "—"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-left text-gray-700">
                    {acc.accountName}
                  </td>
                  {acc.monthly.map((v, i) => (
                    <td key={i} className="whitespace-nowrap px-1 py-1 text-gray-500">
                      {v === 0 ? (
                        <span className="block px-1 text-right tabular-nums">{neg(v)}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDetail({ acc, month: i + 1 })}
                          title={`Belege · ${MONTH_LONG[i]} ${year}`}
                          className={cellBtn}
                        >
                          {neg(v)}
                        </button>
                      )}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-1 py-1 font-medium text-gray-700">
                    {acc.total === 0 ? (
                      <span className="block px-1 text-right tabular-nums">{neg(acc.total)}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDetail({ acc, month: null })}
                        title="Alle Belege dieses Kontos"
                        className={cellBtn}
                      >
                        {neg(acc.total)}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}

            {/* Sum of expenses */}
            <tr className="border-b border-gray-300">
              <td
                colSpan={2}
                className="whitespace-nowrap px-2 py-2 text-left font-medium text-gray-700"
              >
                Summe Aufwand
              </td>
              {guv.expenseMonthly.map((v, i) => (
                <td key={i} className="whitespace-nowrap px-2 py-2 font-medium text-gray-700">
                  {neg(v)}
                </td>
              ))}
              <td className="whitespace-nowrap px-2 py-2 font-medium text-gray-900">
                {neg(guv.expenseTotal)}
              </td>
            </tr>

            {/* Result */}
            <tr className="border-t border-gray-300 font-semibold text-gray-900">
              <td colSpan={2} className="whitespace-nowrap px-2 py-2 text-left">
                Ergebnis
              </td>
              {guv.resultMonthly.map((v, i) => (
                <td
                  key={i}
                  className={`whitespace-nowrap px-2 py-2 ${
                    v < 0 ? "text-brand-red" : "text-emerald-600"
                  }`}
                >
                  {fmt.format(v)}
                </td>
              ))}
              <td
                className={`whitespace-nowrap px-2 py-2 ${
                  guv.resultTotal < 0 ? "text-brand-red" : "text-emerald-600"
                }`}
              >
                {fmt.format(guv.resultTotal)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {detail && (
        <GuvDetailModal detail={detail} year={year} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}

function GuvDetailModal({
  detail,
  year,
  onClose,
}: {
  detail: Detail;
  year: number;
  onClose: () => void;
}) {
  const { acc, month } = detail;
  const entries = (month == null ? acc.entries : acc.entries.filter((e) => e.month === month)).slice();
  const sum = entries.reduce((s, e) => s + e.net, 0);
  const period = month == null ? `Gesamt ${year}` : `${MONTH_LONG[month - 1]} ${year}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-xl border border-gray-300 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b border-gray-200 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {acc.accountNumber ? `${acc.accountNumber} – ` : ""}
              {acc.accountName}
            </h3>
            <p className="mt-0.5 text-xs text-gray-500">
              {period} · {entries.length} {entries.length === 1 ? "Beleg" : "Belege"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-gray-400 transition-colors hover:text-gray-700"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">Keine Belege.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3 font-semibold">Datum</th>
                  <th className="py-2 pr-3 font-semibold">Lieferant</th>
                  <th className="py-2 pr-3 font-semibold">Beleg-Nr.</th>
                  <th className="py-2 pr-3 font-semibold">Herkunft</th>
                  <th className="py-2 pr-3 text-right font-semibold">Netto</th>
                  <th className="py-2 font-semibold">Beleg</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-gray-700">
                      {formatDate(e.date)}
                    </td>
                    <td className="py-2 pr-3 text-gray-900">{e.party}</td>
                    <td className="py-2 pr-3 tabular-nums text-gray-600">{e.number || "—"}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          e.source === "manuell"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-gray-200 text-gray-600"
                        }`}
                      >
                        {e.source === "manuell" ? "Manuell" : "HERO"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums text-gray-800">
                      {fmt.format(e.net)}
                    </td>
                    <td className="py-2">
                      {e.docUrl ? (
                        <a
                          href={e.docUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand-red hover:underline"
                        >
                          ansehen
                        </a>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 font-semibold text-gray-900">
                  <td colSpan={4} className="py-2 pr-3 text-right">
                    Summe
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">
                    {fmt.format(sum)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
