"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  importBankStatement,
  getPendingBankList,
  getStatementHistory,
  deleteStatement,
  confirmBankMatches,
  type BankAnalysisResult,
  type BankMatch,
  type ConfirmLine,
  type OpenBeleg,
} from "@/app/dashboard/belege/bank-import";
import type { StatementImport } from "@/lib/bank-imports";

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const eurCost = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 4 });
function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return y && m && day ? `${day}.${m}.${y}` : d;
}
function fmtStamp(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Auswahl je Buchung (txnId → Liste zugeordneter Beleg-IDs), Vorschläge vorbelegt. */
function syncSel(matches: BankMatch[], prev: Record<number, string[]>): Record<number, string[]> {
  const next: Record<number, string[]> = {};
  for (const m of matches) {
    const existing = prev[m.txnId];
    // Bereits getroffene (nicht-leere) Zuordnung behalten; sonst aktuellen Vorschlag übernehmen.
    next[m.txnId] = existing && existing.length > 0 ? existing : m.heroId ? [m.heroId] : [];
  }
  return next;
}

export default function KontoauszugClient({
  initial,
  initialHistory,
}: {
  initial: BankAnalysisResult;
  initialHistory: StatementImport[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, startBusy] = useTransition();
  const [result, setResult] = useState<BankAnalysisResult>(initial);
  const [history, setHistory] = useState<StatementImport[]>(initialHistory);
  const [sel, setSel] = useState<Record<number, string[]>>(() => syncSel(initial.matches, {}));
  // Welche zugeordneten Buchungen sollen gespeichert werden (Häkchen je Zeile).
  const [save, setSave] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(initial.error ?? null);
  const [info, setInfo] = useState<string | null>(null);
  const [confirming, startConfirm] = useTransition();
  const [rechecking, startRecheck] = useTransition();
  const [deleting, setDeleting] = useState<string | null>(null);

  const recheck = () => {
    setError(null);
    setInfo(null);
    startRecheck(async () => {
      await reloadList(sel);
      setInfo("Offene Buchungen neu geprüft.");
    });
  };

  const reloadList = async (prev: Record<number, string[]>) => {
    const [r, h] = await Promise.all([getPendingBankList(), getStatementHistory()]);
    setResult(r);
    setHistory(h);
    setSel(syncSel(r.matches, prev));
    if (r.error) setError(r.error);
  };

  const onDelete = (s: StatementImport) => {
    const label = s.statementNumber || s.filename || "diesen Auszug";
    if (!window.confirm(`Kontoauszug „${label}" löschen? Offene Buchungen daraus werden entfernt (bereits zugeordnete bleiben).`)) {
      return;
    }
    setDeleting(s.fileHash);
    setError(null);
    setInfo(null);
    startConfirm(async () => {
      const res = await deleteStatement(s.fileHash);
      if (res.error) setError(res.error);
      else setInfo(`Auszug gelöscht · ${res.removed} offene Buchung(en) entfernt.`);
      await reloadList(sel);
      setDeleting(null);
    });
  };

  const run = () => {
    const f = fileRef.current?.files?.[0];
    if (!f) {
      setError("Bitte eine Datei wählen.");
      return;
    }
    setError(null);
    setInfo(null);
    const fd = new FormData();
    fd.set("file", f);
    startBusy(async () => {
      const res = await importBankStatement(fd);
      if (res.error) {
        setError(res.error);
        if (res.warning) setInfo(res.warning);
        return;
      }
      const parts = [`${res.added} neue Buchung(en) hinzugefügt`];
      if (res.added < res.total) parts.push(`${res.total - res.added} bereits bekannt`);
      if (res.costEur != null) parts.push(`OCR-Kosten ca. ${eurCost.format(res.costEur)}`);
      if (res.warning) parts.push(res.warning);
      setInfo(parts.join(" · "));
      if (fileRef.current) fileRef.current.value = "";
      await reloadList(sel);
    });
  };

  const addBeleg = (txnId: number, heroId: string) => {
    if (!heroId) return;
    setSel((p) => {
      const cur = p[txnId] ?? [];
      if (cur.includes(heroId)) return p;
      return { ...p, [txnId]: [...cur, heroId] };
    });
  };
  const removeBeleg = (txnId: number, heroId: string) =>
    setSel((p) => ({ ...p, [txnId]: (p[txnId] ?? []).filter((x) => x !== heroId) }));

  const belegById = useMemo(() => {
    const m = new Map<string, { number: string; supplier: string; gross: number; skontoAmount: number | null }>();
    for (const b of result.openBelege) m.set(b.heroId, b);
    return m;
  }, [result]);

  // Ein Beleg darf insgesamt nur einer Buchung zugeordnet sein.
  const dupHeroIds = useMemo(() => {
    const seen = new Map<string, number>();
    for (const list of Object.values(sel)) for (const id of list) seen.set(id, (seen.get(id) ?? 0) + 1);
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  }, [sel]);

  // Eine Zeile ist gespeichert-markiert, wenn sie zugeordnet UND angehakt ist.
  // Standard: zugeordnete Zeilen sind angehakt (kann je Zeile abgewählt werden).
  const isChecked = (txnId: number) =>
    (sel[txnId] ?? []).length > 0 && (save[txnId] ?? true);
  const toggleSave = (txnId: number) => setSave((p) => ({ ...p, [txnId]: !(p[txnId] ?? true) }));

  const selectableTxnIds = useMemo(
    () => result.matches.filter((m) => (sel[m.txnId] ?? []).length > 0).map((m) => m.txnId),
    [result, sel]
  );
  const checkedCount = useMemo(
    () => selectableTxnIds.filter((id) => isChecked(id)).length,
    [selectableTxnIds, save] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const allChecked = selectableTxnIds.length > 0 && checkedCount === selectableTxnIds.length;
  const toggleAll = () => {
    const v = !allChecked;
    setSave((p) => {
      const n = { ...p };
      for (const id of selectableTxnIds) n[id] = v;
      return n;
    });
  };

  const confirm = () => {
    const lines: ConfirmLine[] = [];
    for (const m of result.matches) {
      const heroIds = sel[m.txnId] ?? [];
      if (heroIds.length === 0 || !isChecked(m.txnId)) continue;
      lines.push({
        txnId: m.txnId,
        heroIds,
        note: `Kontoauszug ${fmtDate(m.txn.date)} · ${euro.format(m.txn.amount)}`,
      });
    }
    if (lines.length === 0) {
      setError("Keine Buchung zum Speichern ausgewählt.");
      return;
    }
    setError(null);
    setInfo(null);
    startConfirm(async () => {
      const res = await confirmBankMatches(lines);
      if (res.error) {
        setError(res.error);
        return;
      }
      setInfo(`${res.count} Beleg(e) als „bezahlt" gespeichert · gespeicherte Buchungen entfernt.`);
      // Gespeicherte Buchungen verschwinden serverseitig; übrige Auswahl bleibt erhalten.
      await reloadList(sel);
    });
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Lade-Overlay während Einlesen / Speichern */}
      {(busy || confirming || rechecking) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 rounded-xl border border-gray-300 bg-white px-10 py-8 shadow-2xl">
            <span className="h-10 w-10 animate-spin rounded-full border-4 border-gray-300 border-t-brand-red" />
            <p className="text-sm font-medium text-gray-800">
              {busy
                ? "Kontoauszug wird eingelesen …"
                : rechecking
                  ? "Offene Buchungen werden neu geprüft …"
                  : "Wird gespeichert …"}
            </p>
            <p className="text-xs text-gray-500">Das kann bei vielen Buchungen einen Moment dauern.</p>
          </div>
        </div>
      )}

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
            {busy ? "Lese Auszug …" : "Kontoauszug einlesen"}
          </button>
          <button
            type="button"
            onClick={recheck}
            disabled={rechecking || busy || result.matches.length === 0}
            title="Die Buchungen in der Liste erneut gegen die offenen Belege abgleichen"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900 disabled:opacity-50"
          >
            {rechecking ? "Prüfe …" : "Offene Buchungen neu prüfen"}
          </button>
          <span className="text-xs text-gray-500">PDF, CSV/TXT oder XLSX · nur Abgänge</span>
        </div>
        {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
        {info && <p className="mt-3 text-sm text-amber-300">{info}</p>}
      </div>

      {/* Persistente Liste offener Buchungen */}
      <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-medium text-gray-900">Offene Buchungen · Sichtkontrolle</h2>
          <span className="text-sm text-gray-600">{result.info}</span>
        </div>

        {result.matches.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-500">
            Keine offenen Buchungen. Lade oben einen Kontoauszug hoch.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-700">
                    <th className="px-3 py-3 text-center font-medium">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={toggleAll}
                        disabled={selectableTxnIds.length === 0}
                        title="Alle zugeordneten auswählen"
                        aria-label="Alle auswählen"
                      />
                    </th>
                    <th className="px-4 py-3 font-medium">Datum</th>
                    <th className="px-4 py-3 font-medium text-right">Betrag</th>
                    <th className="px-4 py-3 font-medium">Empfänger / Zweck</th>
                    <th className="px-4 py-3 font-medium">Treffer</th>
                    <th className="px-4 py-3 font-medium">Beleg-Zuordnung (mehrere möglich)</th>
                  </tr>
                </thead>
                <tbody>
                  {result.matches.map((m) => {
                    const list = sel[m.txnId] ?? [];
                    const sumGross = list.reduce((s, id) => s + (belegById.get(id)?.gross ?? 0), 0);
                    const sumSkonto = list.reduce((s, id) => {
                      const b = belegById.get(id);
                      return s + ((b?.skontoAmount ?? b?.gross) ?? 0);
                    }, 0);
                    const hasSkonto = list.some((id) => belegById.get(id)?.skontoAmount != null);
                    const sumOff =
                      list.length > 0 &&
                      Math.abs(sumGross - m.txn.amount) > 0.02 &&
                      Math.abs(sumSkonto - m.txn.amount) > 0.02;
                    return (
                      <tr key={m.txnId} className="border-b border-gray-200 last:border-0 align-top hover:bg-gray-100">
                        <td className="px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={isChecked(m.txnId)}
                            disabled={list.length === 0}
                            onChange={() => toggleSave(m.txnId)}
                            title={list.length === 0 ? "Erst einen Beleg zuordnen" : "Zum Speichern auswählen"}
                            aria-label="Buchung zum Speichern auswählen"
                          />
                        </td>
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
                              m.heroId
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
                                    onClick={() => removeBeleg(m.txnId, id)}
                                    className="shrink-0 text-gray-400 hover:text-rose-400"
                                    aria-label="Entfernen"
                                  >
                                    ✕
                                  </button>
                                </span>
                              );
                            })}
                            <BelegPicker
                              belege={result.openBelege}
                              exclude={list}
                              onPick={(id) => addBeleg(m.txnId, id)}
                            />
                            {list.length > 0 && (
                              <span className={`text-xs ${sumOff ? "text-amber-400" : "text-gray-500"}`}>
                                Summe zugeordnet: {euro.format(sumGross)}
                                {hasSkonto ? ` (mit Skonto ${euro.format(sumSkonto)})` : ""}
                                {sumOff ? ` ≠ Buchung ${euro.format(m.txn.amount)}` : ""}
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
              <span className="text-sm text-gray-600">
                {checkedCount} von {selectableTxnIds.length} ausgewählt
              </span>
              <button
                type="button"
                onClick={confirm}
                disabled={confirming || checkedCount === 0 || dupHeroIds.size > 0}
                className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {confirming ? "Speichere …" : `Ausgewählte speichern & entfernen (${checkedCount})`}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Historie der eingelesenen Kontoauszüge */}
      <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-medium text-gray-900">Historie · eingelesene Kontoauszüge</h2>
        </div>
        {history.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-gray-500">Noch keine Auszüge eingelesen.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-700">
                  <th className="px-4 py-3 font-medium">Auszug-Nr.</th>
                  <th className="px-4 py-3 font-medium">Datei</th>
                  <th className="px-4 py-3 font-medium">Eingelesen</th>
                  <th className="px-4 py-3 font-medium text-right">Buchungen</th>
                  <th className="px-4 py-3 font-medium text-right">Summe</th>
                  <th className="px-4 py-3 font-medium text-right">OCR-Kosten</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {history.map((s) => (
                  <tr key={s.fileHash} className="border-b border-gray-200 last:border-0 hover:bg-gray-100">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{s.statementNumber || "—"}</td>
                    <td className="px-4 py-2.5 break-words text-gray-700">{s.filename || "—"}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">
                      {fmtStamp(s.importedAt)}
                      {s.importedByName ? ` · ${s.importedByName}` : ""}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700">
                      {s.txCount ?? "—"}
                      {s.openCount > 0 ? <span className="text-amber-400"> ({s.openCount} offen)</span> : null}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700">
                      {s.total != null ? euro.format(s.total) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600">
                      {s.costEur != null ? `ca. ${eurCost.format(s.costEur)}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => onDelete(s)}
                        disabled={deleting === s.fileHash}
                        className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-brand-red disabled:opacity-50"
                      >
                        {deleting === s.fileHash ? "…" : "Löschen"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** Durchsuchbare Beleg-Auswahl (nach Belegnummer oder Lieferant). */
function BelegPicker({
  belege,
  exclude,
  onPick,
}: {
  belege: OpenBeleg[];
  exclude: string[];
  onPick: (heroId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const pool = belege.filter((b) => !exclude.includes(b.heroId));
    const list = s
      ? pool.filter(
          (b) => b.number.toLowerCase().includes(s) || b.supplier.toLowerCase().includes(s)
        )
      : pool;
    return list.slice(0, 10);
  }, [q, belege, exclude]);

  return (
    <div className="relative w-full max-w-md">
      <input
        type="text"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="+ Beleg suchen (Nr. / Lieferant) …"
        className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 outline-none focus:border-brand-red/60"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-300 bg-white shadow-lg">
          {filtered.map((b) => (
            <li key={b.heroId}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(b.heroId);
                  setQ("");
                  setOpen(false);
                }}
                className="block w-full px-2 py-1.5 text-left text-sm text-gray-800 hover:bg-gray-100"
              >
                {b.number} · {b.supplier} · {euro.format(b.gross)}
                {b.skontoAmount != null ? ` · Skonto ${euro.format(b.skontoAmount)}` : ""}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
