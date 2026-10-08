"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { listPageLinesAction, addLineAction, extractLineAmountAction } from "@/app/dashboard/belege/kontoauszug/actions";
import type { StatementLine } from "@/lib/kontoauszuege";
import LineAssignList from "@/components/LineAssignList";

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

/** Schneidet einen Bereich aus einem Canvas aus und liefert ihn als Base64-PNG (ohne data:-Prefix). */
function cropCanvasToPngBase64(source: HTMLCanvasElement, left: number, top: number, width: number, height: number): string | null {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const crop = document.createElement("canvas");
  crop.width = w;
  crop.height = h;
  const ctx = crop.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, Math.round(left), Math.round(top), w, h, 0, 0, w, h);
  return crop.toDataURL("image/png").split(",")[1] ?? null;
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
  const [pendingDate, setPendingDate] = useState(""); // yyyy-mm-dd, für <input type="date">
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Betrag/Datum werden per KI aus dem gezogenen Ausschnitt vorausgefüllt (bleiben korrigierbar).
  const [ocrBusy, setOcrBusy] = useState(false);

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
      const left = Math.min(dragStart.x, dragCurrent.x);
      const top = Math.min(dragStart.y, dragCurrent.y);
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
        setPendingDate("");
        setCreateError(null);

        // Betrag + Datum aus dem gezogenen Ausschnitt per KI vorausfüllen (korrigierbar).
        const canvas = canvasRef.current;
        const crop = canvas ? cropCanvasToPngBase64(canvas, left, top, width, height) : null;
        if (crop) {
          setOcrBusy(true);
          void extractLineAmountAction(crop).then((res) => {
            setOcrBusy(false);
            if (res.amount != null) {
              setPendingAmount(res.amount.toFixed(2).replace(".", ","));
            }
            if (res.date != null) {
              setPendingDate(res.date);
            }
          });
        }
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
    if (!pendingDate) {
      setCreateError("Bitte das Buchungsdatum angeben (wird als Bezahldatum verwendet).");
      return;
    }
    setCreating(true);
    setCreateError(null);
    const res = await addLineAction(page, pendingPdfRect, amount, pendingDate);
    setCreating(false);
    if (res.ok) {
      setPendingPdfRect(null);
      setPendingAmount("");
      setPendingDate("");
      onChanged();
      await loadPage();
    } else {
      setCreateError(res.error ?? "Anlegen fehlgeschlagen.");
    }
  };

  const cancelNewLine = () => {
    setPendingPdfRect(null);
    setPendingAmount("");
    setPendingDate("");
    setCreateError(null);
  };

  // Nach jeder Änderung über `LineAssignList` (zuordnen/entfernen/löschen): Elternkomponente
  // informieren (PDF-Vorschau im Hintergrund neu laden) und die eigene Zeilenliste + Overlay neu holen.
  const handleLinesReload = async () => {
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
            Mit der Maus einen Rahmen um eine Zeile ziehen – Betrag wird automatisch erkannt (korrigierbar), dann Belege zuordnen.
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
                <p className="mb-1.5 text-xs font-semibold text-gray-700">Neue Zeile – Soll-Betrag + Buchungsdatum:</p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    autoFocus
                    value={pendingAmount}
                    onChange={(e) => setPendingAmount(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void confirmNewLine()}
                    placeholder={ocrBusy ? "Wird erkannt …" : "z. B. 1646,80"}
                    disabled={ocrBusy}
                    className="w-28 border border-line px-2 py-1 text-xs outline-none focus:border-brand-red/60 disabled:bg-gray-100"
                  />
                  <input
                    type="date"
                    value={pendingDate}
                    onChange={(e) => setPendingDate(e.target.value)}
                    disabled={ocrBusy}
                    className="border border-line px-2 py-1 text-xs outline-none focus:border-brand-red/60 disabled:bg-gray-100"
                  />
                  <button
                    type="button"
                    onClick={confirmNewLine}
                    disabled={creating || ocrBusy}
                    className="rounded-md bg-brand-red px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {creating ? "…" : "Anlegen"}
                  </button>
                  <button type="button" onClick={cancelNewLine} className="text-xs text-gray-500 hover:text-gray-800">
                    Abbrechen
                  </button>
                </div>
                {ocrBusy && <p className="mt-1 text-xs text-gray-400">Betrag/Datum werden aus dem Ausschnitt erkannt …</p>}
                <p className="mt-1 text-[11px] text-gray-400">
                  Das Datum wird als Bezahldatum verwendet, sobald hier zugeordnete Belege abgehakt werden.
                </p>
                {createError && <p className="mt-1 text-xs text-rose-600">{createError}</p>}
              </div>
            )}

            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Zeilen auf dieser Seite ({lines.length})
            </h4>
            {lines.length === 0 && !pendingPdfRect && (
              <p className="text-xs text-gray-500">Noch keine Zeile markiert. Mit der Maus einen Rahmen ziehen.</p>
            )}
            <LineAssignList lines={lines} onReload={handleLinesReload} />
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
