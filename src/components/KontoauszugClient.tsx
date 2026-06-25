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
  // Auswahl je Buchungszeile: Liste von HERO-Beleg-IDs (Mehrfachzuordnung möglich).
  const [sel, setSel] = useState<Record<number, string[]>>({});
  const [confirming, startConfirm] = useTransition();
  const [done, setDone] = useState<string | null>(null);

  const reset = () => {
    setResult(null);
    setSel({});
    setError(null);
    setDone(null);
    if (fileRef.current) fileRef.current.value = "";
  };

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
      const init: Record<number, string[]> = {};
      res.matches.forEach((m, i) => (init[i] = m.heroId ? [m.heroId] : []));
      setSel(init);
    });
  };

  const addBeleg = (i: number, heroId: string) => {
    if (!heroId) return;
    setSel((p) => {
      const cur = p[i] ?? [];
      if (cur.includes(heroId)) return p;
      return { ...p, [i]: [...cur, heroId] };
    });
  };
  const removeBeleg = (i: number, heroId: string) =>
    setSel((p) => ({ ...p, [i]: (p[i] ?? []).filter((x) => x !== heroId) }));

  const belegById = useMemo(() => {
    const m = new Map<string, { number: string; supplier: string; gross: number }>();
    for (const b of result?.openBelege ?? []) m.set(b.heroId, b);
    return m;
  }, [result]);

  // Ein Beleg darf insgesamt nur einmal zugeordnet sein.
  const dupHeroIds = useMemo(() => {
    const seen = new Map<string, number>();
    for (const list of Object.values(sel)) for (const id of list) seen.set(id, (seen.get(id) ?? 0) + 1);
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  }, [sel]);

  const chosenCount = useMemo(
    () => Object.values(sel).reduce((s, l) => s + l.length, 0),
    [sel]
  );

  const confirm = () => {
    if (!result) return;
    const assignments: ConfirmAssignment[] = [];
    result.matches.forEach((m, i) => {
      for (const heroId of sel[i] ?? []) {
        assignments.push({
          heroId,
          note: `Kontoauszug ${fmtDate(m.txn.date)} · ${euro.format(m.txn.amount)}`,
        });
      }
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
      reset();
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
          {result && (
            <button
              type="button"
              onClick={reset}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
            >
              Abbrechen
            </button>
          )}
          <span className="text-xs text-gray-500">PDF, CSV/TXT oder XLSX · nur Abgänge</span>
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
            <h2 className="text-lg font-medium text-gray-900">Abgleich · Sichtkontrolle (nur Abgänge)</h2>
            <span className="text-sm text-gray-600">{result.info}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-700">
                  <th className="px-4 py-3 font-medium">Datum</th>
                  <th className="px-4 py-3 font-medium text-right">Betrag</th>
                  <th className="px-4 py-3 font-medium">Empfänger / Zweck</th>
                  <th className="px-4 py-3 font-medium">Treffer</th>
                  <th className="px-4 py-3 font-medium">Beleg-Zuordnung (mehrere möglich)</th>
                </tr>
              </thead>
              <tbody>
                {result.matches.map((m, i) => {
                  const list = sel[i] ?? [];
                  const sum = list.reduce((s, id) => s + (belegById.get(id)?.gross ?? 0), 0);
                  const sumOff = list.length > 0 && Math.abs(sum - m.txn.amount) > 0.02;
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
                        {/* gewählte Belege als Chips */}
                        <div className="flex flex-col gap-1.5">
                          {list.map((id) => {
                            const b = belegById.get(id);
                            const dup = dupHeroIds.has(id);
                            return (
                              <span
                                key={id}
                                className={`inline-flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-xs ${
                                  dup ? "border-rose-500 text-rose-300" : "border-gray-300 text-gray-700"
                                }`}
                              >
                                <span className="truncate">
                                  {b ? `${b.number} · ${b.supplier} · ${euro.format(b.gross)}` : id}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeBeleg(i, id)}
                                  className="shrink-0 text-gray-400 hover:text-rose-400"
                                  aria-label="Entfernen"
                                >
                                  ✕
                                </button>
                              </span>
                            );
                          })}
                          {/* Beleg hinzufügen */}
                          <select
                            value=""
                            onChange={(e) => {
                              addBeleg(i, e.target.value);
                              e.currentTarget.value = "";
                            }}
                            className="w-full max-w-md rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 outline-none focus:border-brand-red/60"
                          >
                            <option value="">+ Beleg hinzufügen …</option>
                            {result.openBelege
                              .filter((b) => !list.includes(b.heroId))
                              .map((b) => (
                                <option key={b.heroId} value={b.heroId}>
                                  {b.number} · {b.supplier} · {euro.format(b.gross)}
                                </option>
                              ))}
                          </select>
                          {list.length > 0 && (
                            <span className={`text-xs ${sumOff ? "text-amber-400" : "text-gray-500"}`}>
                              Summe zugeordnet: {euro.format(sum)}
                              {sumOff ? ` (≠ Buchung ${euro.format(m.txn.amount)})` : ""}
                            </span>
                          )}
                        </div>
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
                Ein Beleg ist mehrfach zugeordnet – bitte auflösen.
              </span>
            )}
            <span className="text-sm text-gray-600">{chosenCount} Beleg(e) zugeordnet</span>
            <button
              type="button"
              onClick={reset}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
            >
              Abbrechen
            </button>
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
