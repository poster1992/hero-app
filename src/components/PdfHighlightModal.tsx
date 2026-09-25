"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { addPdfHighlightsAction } from "@/app/dashboard/belege/kontoauszug/actions";
import { MARKER_COLORS, markerColorHex, type MarkerColor } from "@/lib/kontoauszug-colors";
import type { HighlightRect } from "@/lib/kontoauszuege";

/** Nur der Ausschnitt der pdfjs-`PageViewport`, den wir für die Koordinaten-Umrechnung brauchen. */
interface MinimalViewport {
  convertToPdfPoint(x: number, y: number): number[];
}

interface PendingRect {
  x: number;
  y: number;
  width: number;
  height: number;
  color: MarkerColor;
}

/**
 * Echter Textmarker: rendert eine einzelne PDF-Seite (via pdfjs-dist) auf ein
 * Canvas, lässt per Maus-Ziehen halbtransparente Rechtecke aufziehen und
 * brennt sie beim Speichern dauerhaft in die PDF-Datei ein (server-seitig via
 * pdf-lib). Bewusst als eigenes Fenster statt den Haupt-Viewer zu ersetzen –
 * der bleibt der native, schnelle Browser-PDF-Viewer zum Lesen/Blättern.
 */
export default function PdfHighlightModal({
  page,
  onClose,
  onSaved,
}: {
  page: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<MinimalViewport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [color, setColor] = useState<MarkerColor>("yellow");
  const [rects, setRects] = useState<PendingRect[]>([]);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const doc = await pdfjsLib.getDocument({ url: "/api/kontoauszug-datei" }).promise;
        const pdfPage = await doc.getPage(page);
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const targetWidth = Math.min(900, containerRef.current?.clientWidth || 900);
        const scale = targetWidth / baseViewport.width;
        const viewport = pdfPage.getViewport({ scale });
        if (cancelled) return;
        viewportRef.current = viewport;
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await pdfPage.render({ canvas, viewport }).promise;
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Seite konnte nicht geladen werden.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page]);

  const relativePos = (e: ReactPointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const box = canvas.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };

  const handlePointerDown = (e: ReactPointerEvent) => {
    if (loading) return;
    const pos = relativePos(e);
    setDragStart(pos);
    setDragCurrent(pos);
  };
  const handlePointerMove = (e: ReactPointerEvent) => {
    if (!dragStart) return;
    setDragCurrent(relativePos(e));
  };
  const handlePointerUp = () => {
    if (dragStart && dragCurrent) {
      const width = Math.abs(dragCurrent.x - dragStart.x);
      const height = Math.abs(dragCurrent.y - dragStart.y);
      if (width >= 4 && height >= 4) {
        setRects((prev) => [
          ...prev,
          { x: Math.min(dragStart.x, dragCurrent.x), y: Math.min(dragStart.y, dragCurrent.y), width, height, color },
        ]);
      }
    }
    setDragStart(null);
    setDragCurrent(null);
  };

  const removeRect = (index: number) => setRects((prev) => prev.filter((_, i) => i !== index));

  const handleSave = async () => {
    const viewport = viewportRef.current;
    if (!viewport || rects.length === 0) return;
    setSaving(true);
    setSaveError(null);
    const pdfRects: HighlightRect[] = rects.map((r) => {
      const [x1, y1] = viewport.convertToPdfPoint(r.x, r.y);
      const [x2, y2] = viewport.convertToPdfPoint(r.x + r.width, r.y + r.height);
      return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
        color: r.color,
      };
    });
    const res = await addPdfHighlightsAction(page, pdfRects);
    setSaving(false);
    if (res.ok) {
      onSaved();
    } else {
      setSaveError(res.error ?? "Speichern fehlgeschlagen.");
    }
  };

  let previewRect: PendingRect | null = null;
  if (dragStart && dragCurrent) {
    previewRect = {
      x: Math.min(dragStart.x, dragCurrent.x),
      y: Math.min(dragStart.y, dragCurrent.y),
      width: Math.abs(dragCurrent.x - dragStart.x),
      height: Math.abs(dragCurrent.y - dragStart.y),
      color,
    };
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden border border-line bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">Seite {page} markieren</h3>
          <button type="button" onClick={onClose} className="text-gray-400 transition-colors hover:text-gray-700" aria-label="Schließen">
            ✕
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-2">
          <span className="text-xs text-gray-500">Farbe:</span>
          {MARKER_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setColor(c.key)}
              title={c.label}
              style={{ backgroundColor: c.hex }}
              className={`h-5 w-5 rounded-full border-2 ${color === c.key ? "border-gray-900" : "border-transparent"}`}
            />
          ))}
          <span className="text-xs text-gray-400">Mit der Maus über den Text ziehen, um zu markieren.</span>
        </div>

        <div ref={containerRef} className="min-h-0 flex-1 overflow-auto bg-gray-100 p-3">
          {loadError && <p className="p-4 text-sm text-rose-600">{loadError}</p>}
          {loading && !loadError && <p className="p-4 text-sm text-gray-500">Seite wird geladen …</p>}
          <div className="relative inline-block touch-none select-none">
            <canvas ref={canvasRef} className="block" />
            {rects.map((r, i) => (
              <div
                key={i}
                style={{
                  left: r.x,
                  top: r.y,
                  width: r.width,
                  height: r.height,
                  backgroundColor: markerColorHex(r.color),
                  opacity: 0.35,
                }}
                className="pointer-events-none absolute"
              />
            ))}
            {previewRect && (
              <div
                style={{
                  left: previewRect.x,
                  top: previewRect.y,
                  width: previewRect.width,
                  height: previewRect.height,
                  backgroundColor: markerColorHex(previewRect.color),
                  opacity: 0.35,
                }}
                className="pointer-events-none absolute"
              />
            )}
            <div
              className="absolute inset-0"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            />
          </div>
        </div>

        {rects.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-t border-gray-200 px-4 py-2">
            {rects.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => removeRect(i)}
                title="Entfernen"
                className="flex items-center gap-1 rounded-full border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-600 hover:border-rose-300 hover:text-rose-600"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: markerColorHex(r.color) }} />
                Markierung {i + 1} ✕
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-gray-200 px-4 py-3">
          <span className="text-xs text-gray-500">
            {rects.length > 0 ? `${rects.length} Markierung(en) bereit zum Speichern` : "Noch keine Markierung gezogen."}
          </span>
          <div className="flex items-center gap-2">
            {saveError && <span className="text-xs text-rose-600">{saveError}</span>}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || rects.length === 0}
              className="rounded-md bg-brand-red px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Speichert …" : "Im PDF speichern"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
