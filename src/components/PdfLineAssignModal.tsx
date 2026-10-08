"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  listPageLinesAction,
  addLineAction,
  deleteLineAction,
  addReceiptToLineAction,
  removeReceiptFromLineAction,
  searchAssignableReceiptsAction,
} from "@/app/dashboard/belege/kontoauszug/actions";
import type { StatementLine, AssignableReceiptOption } from "@/lib/kontoauszuege";

/** Nur der Ausschnitt der pdfjs-`PageViewport`/`PDFPageProxy`, den wir brauchen. */
interface MinimalViewport {
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
}
interface MinimalPdfPage {
  getViewport(params: { scale: number }): MinimalViewport & { width: number; height: number };
  render(params: { canvas: HTMLCanvasElement; viewport: MinimalViewport }): { promise: Promise<void> };
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

function parseGermanAmount(s: string): number | null {
  const clean = s.trim().replace(/\./g, "").replace(",", ".");
  const n = Number(clean);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function fmtEur(n: number): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

/**
 * Zeilen-Zuordnung: Rechteck um eine Zeile im Kontoauszug ziehen, Soll-Betrag
 * eingeben, dann einen oder mehrere Belege (manuell + HERO) dazu suchen und
 * zuordnen. Stimmt die Summe der zugeordneten Belege, erscheint die Zeile im
 * PDF grün, sonst rot (serverseitig in kontoauszuege.ts gezeichnet). Eigenes
 * Fenster, analog zu PdfHighlightModal, aber mit eigener Interaktion
 * (Betrag + Beleg-Suche statt Farbe + Notiz).
 */
export default function PdfLineAssignModal({
  page,
  onClose,
  onChanged,
}: {
  page: number;
  onClose: () => void;
  /** Wird nach jeder Änderung aufgerufen (Fenster bleibt offen, PDF-Ansicht im Hintergrund soll aktualisieren). */
  onChanged: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfPageRef = useRef<MinimalPdfPage | null>(null);
  const fitScaleRef = useRef(1);
  const [viewport, setViewport] = useState<MinimalViewport | null>(null);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lines, setLines] = useState<StatementLine[]>([]);

  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [pendingPdfRect, setPendingPdfRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [pendingAmount, setPendingAmount] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [searchOpenFor, setSearchOpenFor] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AssignableReceiptOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyLineId, setBusyLineId] = useState<number | null>(null);

  const renderAtScale = async (scale: number) => {
    const proxy = pdfPageRef.current;
    const canvas = canvasRef.current;
    if (!proxy || !canvas) return;
    const newViewport = proxy.getViewport({ scale });
    setViewport(newViewport);
    canvas.width = Math.round(newViewport.width);
    canvas.height = Math.round(newViewport.height);
    await proxy.render({ canvas, viewport: newViewport }).promise;
  };

  const loadPage = async () => {
    try {
      const [pdfjsLib, lineList] = await Promise.all([import("pdfjs-dist"), listPageLinesAction(page)]);
      pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const doc = await pdfjsLib.getDocument({ url: "/api/kontoauszug-datei" }).promise;
      const pdfPage = await doc.getPage(page);
      pdfPageRef.current = pdfPage as unknown as MinimalPdfPage;
      setLines(lineList);
      const baseViewport = pdfPage.getViewport({ scale: 1 });
      const targetWidth = Math.max(320, (containerRef.current?.clientWidth || 900) - 24);
      fitScaleRef.current = targetWidth / baseViewport.width;
      await renderAtScale(fitScaleRef.current * zoom);
      setLoading(false);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Seite konnte nicht geladen werden.");
      setLoading(false);
    }
  };

  // Läuft einmalig beim Mounten (Seitenwechsel remountet über `key` in der Elternkomponente).
  useEffect(() => {
    void loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyZoom = (next: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    setZoom(clamped);
    void renderAtScale(fitScaleRef.current * clamped);
  };

  const relativePos = (e: ReactPointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const box = canvas.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };

  const handlePointerDown = (e: ReactPointerEvent) => {
    if (loading || pendingPdfRect) return; // erst die offene Zeile bestätigen/abbrechen
    const pos = relativePos(e);
    setDragStart(pos);
    setDragCurrent(pos);
  };
  const handlePointerMove = (e: ReactPointerEvent) => {
    if (!dragStart) return;
    setDragCurrent(relativePos(e));
  };
  const handlePointerUp = () => {
    if (dragStart && dragCurrent && viewport) {
      const width = Math.abs(dragCurrent.x - dragStart.x);
      const height = Math.abs(dragCurrent.y - dragStart.y);
      if (width >= 4 && height >= 4) {
        const [x1, y1] = viewport.convertToPdfPoint(dragStart.x, dragStart.y);
        const [x2, y2] = viewport.convertToPdfPoint(dragCurrent.x, dragCurrent.y);
        setPendingPdfRect({
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1),
        });
        setPendingAmount("");
        setCreateError(null);
      }
    }
    setDragStart(null);
    setDragCurrent(null);
  };

  const confirmNewLine = async () => {
    if (!pendingPdfRect) return;
    const amount = parseGermanAmount(pendingAmount);
    if (amount == null) {
      setCreateError("Bitte einen gültigen Betrag eingeben.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    const res = await addLineAction(page, pendingPdfRect, amount);
    setCreating(false);
    if (res.ok) {
      setPendingPdfRect(null);
      setPendingAmount("");
      onChanged();
      await loadPage();
    } else {
      setCreateError(res.error ?? "Anlegen fehlgeschlagen.");
    }
  };

  const cancelNewLine = () => {
    setPendingPdfRect(null);
    setPendingAmount("");
    setCreateError(null);
  };

  const handleDeleteLine = async (id: number) => {
    if (!window.confirm("Diese Zeilen-Zuordnung samt zugeordneter Belege löschen?")) return;
    setBusyLineId(id);
    await deleteLineAction(id);
    setBusyLineId(null);
    onChanged();
    await loadPage();
  };

  const openSearch = (lineId: number) => {
    setSearchOpenFor(lineId);
    setSearchQuery("");
    setSearchResults([]);
  };

  const runSearch = async () => {
    if (searchQuery.trim().length < 2) return;
    setSearching(true);
    const res = await searchAssignableReceiptsAction(searchQuery);
    setSearching(false);
    setSearchResults(res);
  };

  const assignReceipt = async (lineId: number, receipt: AssignableReceiptOption) => {
    setBusyLineId(lineId);
    await addReceiptToLineAction(lineId, receipt);
    setBusyLineId(null);
    setSearchOpenFor(null);
    onChanged();
    await loadPage();
  };

  const removeReceipt = async (lineId: number, linkId: number) => {
    setBusyLineId(lineId);
    await removeReceiptFromLineAction(linkId);
    setBusyLineId(null);
    onChanged();
    await loadPage();
  };

  const toCanvasRect = (r: { x: number; y: number; width: number; height: number }) => {
    if (!viewport) return { left: 0, top: 0, width: 0, height: 0 };
    const [vx1, vy1] = viewport.convertToViewportPoint(r.x, r.y);
    const [vx2, vy2] = viewport.convertToViewportPoint(r.x + r.width, r.y + r.height);
    return {
      left: Math.min(vx1, vx2),
      top: Math.min(vy1, vy2),
      width: Math.abs(vx2 - vx1),
      height: Math.abs(vy2 - vy1),
    };
  };

  let previewRect: { left: number; top: number; width: number; height: number } | null = null;
  if (dragStart && dragCurrent) {
    previewRect = {
      left: Math.min(dragStart.x, dragCurrent.x),
      top: Math.min(dragStart.y, dragCurrent.y),
      width: Math.abs(dragCurrent.x - dragStart.x),
      height: Math.abs(dragCurrent.y - dragStart.y),
    };
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex h-[90vh] w-[90vw] max-w-none flex-col overflow-hidden border border-line bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">Seite {page} · Belege zuordnen</h3>
          <button type="button" onClick={onClose} className="text-gray-400 transition-colors hover:text-gray-700" aria-label="Schließen">
            ✕
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => applyZoom(zoom - ZOOM_STEP)}
              disabled={loading || zoom <= MIN_ZOOM}
              title="Verkleinern"
              className="rounded border border-gray-300 px-2 py-0.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              −
            </button>
            <span className="w-10 text-center text-xs text-gray-500">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={() => applyZoom(zoom + ZOOM_STEP)}
              disabled={loading || zoom >= MAX_ZOOM}
              title="Vergrößern"
              className="rounded border border-gray-300 px-2 py-0.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              +
            </button>
          </div>
          <span className="text-xs text-gray-400">
            Mit der Maus einen Rahmen um eine Zeile ziehen, Betrag eingeben, dann Belege zuordnen.
          </span>
        </div>

        <div className="flex min-h-0 flex-1">
          <div ref={containerRef} className="min-h-0 flex-1 overflow-auto bg-gray-100 p-3">
            {loadError && <p className="p-4 text-sm text-rose-600">{loadError}</p>}
            {loading && !loadError && <p className="p-4 text-sm text-gray-500">Seite wird geladen …</p>}
            <div className="relative inline-block touch-none select-none">
              <canvas ref={canvasRef} className="block" />
              {lines.map((l) => (
                <div
                  key={l.id}
                  style={{ ...toCanvasRect(l), backgroundColor: l.matched ? "#22c55e" : "#ef4444" }}
                  className="pointer-events-none absolute opacity-30"
                />
              ))}
              {pendingPdfRect && (
                <div style={{ ...toCanvasRect(pendingPdfRect), backgroundColor: "#3b82f6" }} className="pointer-events-none absolute opacity-30" />
              )}
              {previewRect && <div style={previewRect} className="pointer-events-none absolute bg-blue-500 opacity-30" />}
              <div
                className="absolute inset-0"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
              />
            </div>
          </div>

          <div className="flex w-[360px] flex-none flex-col overflow-y-auto border-l border-gray-200 bg-gray-50 p-3">
            {pendingPdfRect && (
              <div className="mb-3 border border-blue-300 bg-blue-50 p-2.5">
                <p className="mb-1.5 text-xs font-semibold text-gray-700">Neue Zeile – Soll-Betrag:</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    autoFocus
                    value={pendingAmount}
                    onChange={(e) => setPendingAmount(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void confirmNewLine()}
                    placeholder="z. B. 1646,80"
                    className="w-28 border border-line px-2 py-1 text-xs outline-none focus:border-brand-red/60"
                  />
                  <button
                    type="button"
                    onClick={confirmNewLine}
                    disabled={creating}
                    className="rounded-md bg-brand-red px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {creating ? "…" : "Anlegen"}
                  </button>
                  <button type="button" onClick={cancelNewLine} className="text-xs text-gray-500 hover:text-gray-800">
                    Abbrechen
                  </button>
                </div>
                {createError && <p className="mt-1 text-xs text-rose-600">{createError}</p>}
              </div>
            )}

            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Zeilen auf dieser Seite ({lines.length})
            </h4>
            {lines.length === 0 && !pendingPdfRect && (
              <p className="text-xs text-gray-500">Noch keine Zeile markiert. Mit der Maus einen Rahmen ziehen.</p>
            )}
            <ul className="space-y-2">
              {lines.map((l) => {
                const sum = l.receipts.reduce((s, r) => s + r.amount, 0);
                const diff = l.amount - sum;
                return (
                  <li key={l.id} className="border border-line bg-white p-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-semibold">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: l.matched ? "#16a34a" : "#dc2626" }}
                        />
                        Soll {fmtEur(l.amount)}
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
                    <div className={`mt-0.5 ${l.matched ? "text-emerald-600" : "text-rose-600"}`}>
                      {l.matched ? "✓ Summe passt" : `Fehlt ${fmtEur(diff)}`}
                    </div>

                    {l.receipts.length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {l.receipts.map((r) => (
                          <li key={r.id} className="flex items-center justify-between gap-1 border-t border-gray-100 pt-1">
                            <span className="min-w-0 flex-1 truncate text-gray-600" title={`${r.supplier ?? ""} ${r.invoiceNumber ?? ""}`}>
                              {r.kind === "hero" ? "HERO" : "Manuell"} · {r.supplier ?? "—"} · {fmtEur(r.amount)}
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
                                  onClick={() => assignReceipt(l.id, r)}
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
                        {!searching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                          <p className="mt-1 text-gray-400">Keine Treffer.</p>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openSearch(l.id)}
                        className="mt-2 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:border-brand-red/50 hover:bg-gray-50"
                      >
                        + Beleg zuordnen
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
