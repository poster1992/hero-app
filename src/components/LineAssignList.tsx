"use client";

import { useState } from "react";
import {
  deleteLineAction,
  addReceiptToLineAction,
  removeReceiptFromLineAction,
  setLineConfirmedAction,
  searchAssignableReceiptsAction,
} from "@/app/dashboard/belege/kontoauszug/actions";
import type { StatementLine, AssignableReceiptOption } from "@/lib/kontoauszuege";
import CreateReceiptInline from "@/components/CreateReceiptInline";

function parseGermanAmount(s: string): number | null {
  const clean = s.trim().replace(/\./g, "").replace(",", ".");
  const n = Number(clean);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function fmtEur(n: number): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

/**
 * Liste der Zeilen-Zuordnungen (Soll-Betrag, Status, zugeordnete Belege,
 * Beleg suchen/zuordnen, Beleg/Zeile entfernen) – als eigene Komponente, damit
 * sie sowohl im "Belege zuordnen"-Fenster (`PdfLineAssignModal`, dort zusammen
 * mit dem Rechteck-Zeichnen) als auch direkt in der Seitenleiste
 * (`LineAssignPanel`, ohne Zeichnen) verwendet werden kann, ohne die Logik
 * doppelt zu pflegen.
 */
export default function LineAssignList({
  lines,
  onReload,
}: {
  lines: StatementLine[];
  /** Nach jeder Änderung aufgerufen: Aufrufer soll die Zeilenliste + Haupt-PDF-Ansicht neu laden. */
  onReload: () => void | Promise<void>;
}) {
  const [busyLineId, setBusyLineId] = useState<number | null>(null);
  const [creatingForLine, setCreatingForLine] = useState<number | null>(null);
  const [searchOpenFor, setSearchOpenFor] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AssignableReceiptOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Beleg aus der Suche ausgewählt, aber Betrag noch nicht bestätigt (editierbar wegen Skonto/Teilzahlung).
  const [pickedReceipt, setPickedReceipt] = useState<AssignableReceiptOption | null>(null);
  const [confirmAmount, setConfirmAmount] = useState("");
  const [assigning, setAssigning] = useState(false);

  const handleDeleteLine = async (id: number) => {
    if (!window.confirm("Diese Zeilen-Zuordnung samt zugeordneter Belege löschen?")) return;
    setBusyLineId(id);
    await deleteLineAction(id);
    setBusyLineId(null);
    await onReload();
  };

  const openSearch = (lineId: number) => {
    setSearchOpenFor(lineId);
    setCreatingForLine(null);
    setSearchQuery("");
    setSearchResults([]);
    setSearchError(null);
    setPickedReceipt(null);
    setConfirmAmount("");
  };

  const openCreate = (lineId: number) => {
    // Nutzt dieselbe "Beleg ausgewählt → Betrag bestätigen"-Ansicht wie die Suche,
    // damit der frisch angelegte Beleg sofort zugeordnet werden kann.
    setSearchOpenFor(lineId);
    setCreatingForLine(lineId);
    setSearchQuery("");
    setSearchResults([]);
    setSearchError(null);
    setPickedReceipt(null);
    setConfirmAmount("");
  };

  const handleCreated = (receipt: AssignableReceiptOption) => {
    setCreatingForLine(null);
    pickReceipt(receipt);
  };

  const runSearch = async () => {
    if (searchQuery.trim().length < 2) return;
    setSearching(true);
    setSearchError(null);
    const res = await searchAssignableReceiptsAction(searchQuery);
    setSearching(false);
    setSearchResults(res.results);
    if (res.error) setSearchError(res.error);
  };

  const pickReceipt = (receipt: AssignableReceiptOption) => {
    setPickedReceipt(receipt);
    setConfirmAmount(receipt.amount.toFixed(2).replace(".", ","));
    setSearchError(null);
  };

  const cancelPick = () => {
    setPickedReceipt(null);
    setConfirmAmount("");
  };

  const confirmAssign = async (lineId: number) => {
    if (!pickedReceipt) return;
    const amount = parseGermanAmount(confirmAmount);
    if (amount == null) {
      setSearchError("Bitte einen gültigen Betrag eingeben.");
      return;
    }
    setAssigning(true);
    setSearchError(null);
    const res = await addReceiptToLineAction(lineId, pickedReceipt, amount);
    setAssigning(false);
    if (!res.ok) {
      setSearchError(res.error ?? "Zuordnen fehlgeschlagen.");
      return;
    }
    setPickedReceipt(null);
    setConfirmAmount("");
    setSearchOpenFor(null);
    await onReload();
  };

  const removeReceipt = async (lineId: number, linkId: number) => {
    setBusyLineId(lineId);
    await removeReceiptFromLineAction(linkId);
    setBusyLineId(null);
    await onReload();
  };

  const toggleConfirmed = async (lineId: number, confirmed: boolean) => {
    setBusyLineId(lineId);
    await setLineConfirmedAction(lineId, confirmed);
    setBusyLineId(null);
    await onReload();
  };

  if (lines.length === 0) {
    return <p className="text-xs text-gray-500">Noch keine Zeile markiert.</p>;
  }

  return (
    <ul className="space-y-2">
      {lines.map((l) => {
        const sum = l.receipts.reduce((s, r) => s + r.amount, 0);
        const diff = l.amount - sum;
        const sumMatched = Math.abs(diff) < 0.01;
        const dotColor = sumMatched ? "#16a34a" : l.confirmedWithoutReceipt ? "#f59e0b" : "#dc2626";
        return (
          <li key={l.id} className="border border-line bg-white p-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-semibold">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dotColor }} />
                Soll {fmtEur(l.amount)}
                {l.date && <span className="font-normal text-gray-400">· {l.date.split("-").reverse().join(".")}</span>}
              </span>
              <button
                type="button"
                onClick={() => handleDeleteLine(l.id)}
                disabled={busyLineId === l.id}
                title="Zeile löschen"
                className="text-gray-400 hover:text-rose-600 disabled:opacity-40"
              >
                ✕
              </button>
            </div>
            <div
              className={`mt-0.5 ${sumMatched ? "text-emerald-600" : l.confirmedWithoutReceipt ? "text-amber-600" : "text-rose-600"}`}
            >
              {sumMatched
                ? "✓ Summe passt"
                : l.confirmedWithoutReceipt
                  ? "✓ Manuell geprüft (ohne Beleg)"
                  : `Fehlt ${fmtEur(diff)}`}
              {sumMatched && l.paidApplied && " · Zahlstatus der Belege aktualisiert"}
            </div>
            {!sumMatched && (
              <button
                type="button"
                onClick={() => toggleConfirmed(l.id, !l.confirmedWithoutReceipt)}
                disabled={busyLineId === l.id}
                className={`mt-1 rounded border px-2 py-0.5 text-[11px] font-medium disabled:opacity-40 ${
                  l.confirmedWithoutReceipt
                    ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                    : "border-gray-300 text-gray-600 hover:border-amber-400 hover:bg-amber-50"
                }`}
                title="Für Zahlungseingänge ohne passende Ausgangsrechnung: Zeile ohne Beleg-Zuordnung als geprüft markieren."
              >
                {l.confirmedWithoutReceipt ? "↺ Prüfung zurücknehmen" : "✓ Zahlungseingang geprüft (ohne Beleg)"}
              </button>
            )}

            {l.receipts.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {l.receipts.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-1 border-t border-gray-100 pt-1">
                    <span className="min-w-0 flex-1 truncate text-gray-600" title={`${r.supplier ?? ""} ${r.invoiceNumber ?? ""}`}>
                      {r.kind === "hero" ? "HERO" : "Manuell"} · {r.supplier ?? "—"} · {fmtEur(r.amount)}
                      {r.settlementKind !== "full" && (
                        <span className="ml-1 text-amber-600">
                          ({r.settlementKind === "skonto" ? "Skonto" : "Teilzahlung"})
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeReceipt(l.id, r.id)}
                      disabled={busyLineId === l.id}
                      className="shrink-0 text-gray-400 hover:text-rose-600 disabled:opacity-40"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {searchOpenFor === l.id ? (
              <div className="mt-2 border-t border-gray-100 pt-2">
                {pickedReceipt ? (
                  <div className="border border-blue-300 bg-blue-50 p-2">
                    <p className="font-medium">
                      {pickedReceipt.supplier ?? "—"}
                      {pickedReceipt.invoiceNumber ? ` · ${pickedReceipt.invoiceNumber}` : ""}
                    </p>
                    <p className="text-gray-500">
                      Offen: {fmtEur(pickedReceipt.amount)}
                      {pickedReceipt.skontoPayAmount != null && ` · Skonto: ${fmtEur(pickedReceipt.skontoPayAmount)}`}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <label className="flex items-center gap-1">
                        Zugeordneter Betrag:
                        <input
                          type="text"
                          inputMode="decimal"
                          autoFocus
                          value={confirmAmount}
                          onChange={(e) => setConfirmAmount(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && void confirmAssign(l.id)}
                          className="w-24 border border-line px-2 py-1 text-xs outline-none focus:border-brand-red/60"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => confirmAssign(l.id)}
                        disabled={assigning}
                        className="rounded-md bg-brand-red px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                      >
                        {assigning ? "…" : "Zuordnen"}
                      </button>
                      <button type="button" onClick={cancelPick} className="text-gray-500 hover:text-gray-800">
                        Abbrechen
                      </button>
                    </div>
                    <p className="mt-1 text-[11px] text-gray-400">
                      Entspricht der Betrag genau dem offenen Betrag oder dem Skontobetrag, wird der Beleg
                      automatisch als bezahlt abgehakt; ein kleinerer Betrag gilt als Teilzahlung.
                    </p>
                  </div>
                ) : creatingForLine === l.id ? (
                  <CreateReceiptInline
                    defaultAmount={Math.max(0, diff)}
                    defaultDate={l.date}
                    onCreated={handleCreated}
                    onCancel={() => setCreatingForLine(null)}
                  />
                ) : (
                  <>
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        autoFocus
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && void runSearch()}
                        placeholder="Lieferant oder Belegnr. …"
                        className="min-w-0 flex-1 border border-line px-2 py-1 text-xs outline-none focus:border-brand-red/60"
                      />
                      <button
                        type="button"
                        onClick={runSearch}
                        disabled={searching}
                        className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
                      >
                        {searching ? "…" : "Suchen"}
                      </button>
                      <button type="button" onClick={() => setSearchOpenFor(null)} className="text-gray-400 hover:text-gray-700">
                        ✕
                      </button>
                    </div>
                    {searchResults.length > 0 && (
                      <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
                        {searchResults.map((r, i) => (
                          <li key={`${r.kind}-${r.ref}-${i}`}>
                            <button
                              type="button"
                              onClick={() => pickReceipt(r)}
                              className="block w-full border border-gray-200 px-2 py-1 text-left hover:border-brand-red/50 hover:bg-gray-50"
                            >
                              <span className="font-medium">{r.supplier ?? "—"}</span>{" "}
                              <span className="text-gray-400">
                                {r.invoiceNumber ? `· ${r.invoiceNumber} ` : ""}· {fmtEur(r.amount)}
                                {r.date ? ` · ${r.date.split("-").reverse().join(".")}` : ""}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {searchError && <p className="mt-1 text-rose-600">Fehler: {searchError}</p>}
                    {!searching && !searchError && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                      <p className="mt-1 text-gray-400">Keine Treffer.</p>
                    )}
                    <button
                      type="button"
                      onClick={() => openCreate(l.id)}
                      className="mt-1.5 text-gray-500 underline-offset-2 hover:text-brand-red hover:underline"
                    >
                      Kein Treffer? Neuen Beleg erstellen …
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => openSearch(l.id)}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:border-brand-red/50 hover:bg-gray-50"
                >
                  + Beleg zuordnen
                </button>
                <button
                  type="button"
                  onClick={() => openCreate(l.id)}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:border-brand-red/50 hover:bg-gray-50"
                >
                  + Neuen Beleg erstellen
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
