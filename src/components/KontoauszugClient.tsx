"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  analyzeBankStatement,
  confirmBankMatches,
  type BankAnalysisResult,
  type ConfirmAssignment,
} from "@/app/dashboard/belege/bank-import";

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return y && m && day ? `${day}.${m}.${y}` : d;
}

export default function KontoauszugClient() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, startBusy] = useTransition();
  const [result, setResult] = useState<BankAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Auswahl je Buchungszeile: HERO-Beleg-ID oder "" (keine Zuordnung).
  const [sel, setSel] = useState<Record<number, string>>({});
  const [confirming, startConfirm] = useTransition();
  const [done, setDone] = useState<string | null>(null);

  const run = () => {
    const f = fileRef.current?.files?.[0];
    if (!f) {
      setError("Bitte eine Datei wählen.");
      return;
    }
    setError(null);
    setDone(null);
    setResult(null);
    const fd = new FormData();
    fd.set("file", f);
    startBusy(async () => {
      const res = await analyzeBankStatement(fd);
      if (res.error) setError(res.error);
      setResult(res);
      // Vorschläge als Startauswahl übernehmen.
      const init: Record<number, string> = {};
      res.matches.forEach((m, i) => (init[i] = m.heroId ?? ""));
      setSel(init);
    });
  };

  // Belege, die in mehreren Zeilen gewählt sind (Warnung).
  const dupHeroIds = useMemo(() => {
    const seen = new Map<string, number>();
    for (const v of Object.values(sel)) if (v) seen.set(v, (seen.get(v) ?? 0) + 1);
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  }, [sel]);

  const chosenCount = useMemo(() => Object.values(sel).filter(Boolean).length, [sel]);

  const confirm = () => {
    if (!result) return;
    const assignments: ConfirmAssignment[] = [];
    result.matches.forEach((m, i) => {
      const heroId = sel[i];
      if (!heroId) return;
      assignments.push({
        heroId,
        note: `Kontoauszug ${fmtDate(m.txn.date)} · ${euro.format(m.txn.amount)}`,
      });
    });
    if (assignments.length === 0) {
      setError("Keine Zuordnung gewählt.");
      return;
    }
    setError(null);
    startConfirm(async () => {
      const res = await confirmBankMatches(assignments);
      if (res.error) {
        setError(res.error);
        return;
      }
      setDone(`${res.count} Beleg(e) als „bezahlt" markiert.`);
      setResult(null);
      setSel({});
    });
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Upload */}
      <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.csv,.txt,.xlsx,.xls"
            className="text-sm text-gray-700 file:mr-3 file:rounded-md file:border file:border-gray-300 file:bg-gray-50 file:px-3 file:py-1.5 file:text-sm file:text-gray-700"
          />
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Lese Auszug (OCR) …" : "Kontoauszug einlesen"}
          </button>
          <span className="text-xs text-gray-500">PDF, CSV/TXT oder XLSX</span>
        </div>
        {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
        {done && (
          <p className="mt-3 text-sm text-emerald-400">
            {done}{" "}
            <Link href="/dashboard/belege" className="text-brand-red hover:underline">
              → zu den Belegen
            </Link>
          </p>
        )}
      </div>

      {/* Ergebnis / Sichtkontrolle */}
      {result && result.matches.length > 0 && (
        <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
            <h2 className="text-lg font-medium text-gray-900">Abgleich · Sichtkontrolle</h2>
            <span className="text-sm text-gray-600">{result.info}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-700">
                  <th className="px-4 py-3 font-medium">Datum</th>
                  <th className="px-4 py-3 font-medium text-right">Betrag</th>
                  <th className="px-4 py-3 font-medium">Empfänger / Zweck</th>
                  <th className="px-4 py-3 font-medium">Treffer</th>
                  <th className="px-4 py-3 font-medium">Beleg-Zuordnung</th>
                </tr>
              </thead>
              <tbody>
                {result.matches.map((m, i) => {
                  const chosen = sel[i] ?? "";
                  const dup = chosen && dupHeroIds.has(chosen);
                  return (
                    <tr key={i} className="border-b border-gray-200 last:border-0 align-top hover:bg-gray-100">
                      <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">{fmtDate(m.txn.date)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-right text-gray-900">
                        {euro.format(m.txn.amount)}
                      </td>
                      <td className="px-4 py-2.5 text-gray-700">
                        <div className="font-medium text-gray-800">{m.txn.name || "—"}</div>
                        <div className="text-xs text-gray-500 break-words">{m.txn.purpose}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                            m.score >= 3
                              ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                              : m.score > 0
                                ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30"
                                : "bg-gray-400/20 text-gray-400 ring-1 ring-gray-400/30"
                          }`}
                        >
                          {m.reason}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          value={chosen}
                          onChange={(e) => setSel((p) => ({ ...p, [i]: e.target.value }))}
                          className={`w-full max-w-md rounded-md border bg-white px-2 py-1 text-sm text-gray-900 outline-none focus:border-brand-red/60 ${
                            dup ? "border-rose-500" : "border-gray-300"
                          }`}
                        >
                          <option value="">— keine Zuordnung —</option>
                          {result.openBelege.map((b) => (
                            <option key={b.heroId} value={b.heroId}>
                              {b.number} · {b.supplier} · {euro.format(b.gross)}
                            </option>
                          ))}
                        </select>
                        {dup && <p className="mt-1 text-xs text-rose-400">Beleg mehrfach zugeordnet</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-200 px-5 py-4">
            {dupHeroIds.size > 0 && (
              <span className="mr-auto text-sm text-rose-400">
                Bitte doppelte Beleg-Zuordnungen auflösen.
              </span>
            )}
            <span className="text-sm text-gray-600">{chosenCount} zugeordnet</span>
            <button
              type="button"
              onClick={confirm}
              disabled={confirming || chosenCount === 0 || dupHeroIds.size > 0}
              className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {confirming ? "Speichere …" : `Als bezahlt bestätigen (${chosenCount})`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
