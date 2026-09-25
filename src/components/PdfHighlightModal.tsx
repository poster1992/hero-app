"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  addPdfHighlightsAction,
  listPageHighlightsAction,
  deletePdfHighlightAction,
} from "@/app/dashboard/belege/kontoauszug/actions";
import { MARKER_COLORS, markerColorHex, type MarkerColor } from "@/lib/kontoauszug-colors";
import type { HighlightRect, StatementHighlight } from "@/lib/kontoauszuege";

/** Nur der Ausschnitt der pdfjs-`PageViewport`/`PDFPageProxy`, den wir brauchen. */
interface MinimalViewport {
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
}
interface MinimalPdfPage {
  getViewport(params: { scale: number }): MinimalViewport & { width: number; height: number };
  render(params: { canvas: HTMLCanvasElement; viewport: MinimalViewport }): { promise: Promise<void> };
}

/** Ein aufgezogenes Rechteck, in PDF-Koordinaten gespeichert (bleibt beim Zoomen stabil). */
interface PendingRect {
  pdfX: number;
  pdfY: number;
  pdfWidth: number;
  pdfHeight: number;
  color: MarkerColor;
  note: string;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

/**
 * Echter Textmarker: rendert eine einzelne PDF-Seite (via pdfjs-dist) auf ein
 * Canvas, lässt per Maus-Ziehen halbtransparente Rechtecke aufziehen (optional
 * mit Notiz, die zusätzlich als durchsuchbarer Seiten-Marker gespeichert wird)
 * und speichert sie beim Speichern als eigene Datenzeilen (Tabelle
 * `bank_statement_highlights`), aus denen die angezeigte PDF-Datei serverseitig
 * neu zusammengesetzt wird – dadurch bleibt jede einzelne Markierung später
 * über die Liste unten wieder löschbar. Bewusst als eigenes Fenster statt den
 * Haupt-Viewer zu ersetzen – der bleibt der native, schnelle Browser-Viewer.
 */
export default function PdfHighlightModal({
  page,
  onClose,
  onSaved,
  onDeleted,
}: {
  page: number;
  onClose: () => void;
  onSaved: () => void;
  /** Wird nach dem Löschen einer bereits gespeicherten Markierung aufgerufen (Fenster bleibt offen). */
  onDeleted: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfPageRef = useRef<MinimalPdfPage | null>(null);
  const fitScaleRef = useRef(1);
  // Als State statt Ref: wird für die Koordinaten-Umrechnung beim Rendern der
  // Markierungs-Overlays gebraucht (Ref-Zugriff während des Renderns ist nicht
  // erlaubt/zuverlässig).
  const [viewport, setViewport] = useState<MinimalViewport | null>(null);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [color, setColor] = useState<MarkerColor>("yellow");
  const [rects, setRects] = useState<PendingRect[]>([]);
  const [existing, setExisting] = useState<StatementHighlight[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  // Seite (neu) laden: PDF-Seite rendern + bereits gespeicherte Markierungen
  // dieser Seite abrufen. Auch nach dem Löschen einer Markierung erneut
  // aufgerufen, damit Canvas und Liste den aktuellen Stand zeigen.
  const loadPage = async () => {
    try {
      const [pdfjsLib, existingList] = await Promise.all([import("pdfjs-dist"), listPageHighlightsAction(page)]);
      pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const doc = await pdfjsLib.getDocument({ url: "/api/kontoauszug-datei" }).promise;
      const pdfPage = await doc.getPage(page);
      pdfPageRef.current = pdfPage as unknown as MinimalPdfPage;
      setExisting(existingList);
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

  // Läuft einmalig beim Mounten. `loading`/`loadError` starten bereits korrekt
  // über ihren useState-Initialwert – ein Seitenwechsel bei offenem Fenster
  // remountet die Komponente über den `key` in der Elternkomponente neu,
  // statt hier den State manuell zurückzusetzen.
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
    if (dragStart && dragCurrent && viewport) {
      const width = Math.abs(dragCurrent.x - dragStart.x);
      const height = Math.abs(dragCurrent.y - dragStart.y);
      if (width >= 4 && height >= 4) {
        const [x1, y1] = viewport.convertToPdfPoint(dragStart.x, dragStart.y);
        const [x2, y2] = viewport.convertToPdfPoint(dragCurrent.x, dragCurrent.y);
        setRects((prev) => [
          ...prev,
          {
            pdfX: Math.min(x1, x2),
            pdfY: Math.min(y1, y2),
            pdfWidth: Math.abs(x2 - x1),
            pdfHeight: Math.abs(y2 - y1),
            color,
            note: "",
          },
        ]);
      }
    }
    setDragStart(null);
    setDragCurrent(null);
  };

  const removeRect = (index: number) => setRects((prev) => prev.filter((_, i) => i !== index));
  const setRectNote = (index: number, note: string) =>
    setRects((prev) => prev.map((r, i) => (i === index ? { ...r, note } : r)));

  const handleSave = async () => {
    if (rects.length === 0) return;
    setSaving(true);
    setSaveError(null);
    const pdfRects: HighlightRect[] = rects.map((r) => ({
      x: r.pdfX,
      y: r.pdfY,
      width: r.pdfWidth,
      height: r.pdfHeight,
      color: r.color,
      note: r.note.trim() || undefined,
    }));
    const res = await addPdfHighlightsAction(page, pdfRects);
    setSaving(false);
    if (res.ok) {
      onSaved();
    } else {
      setSaveError(res.error ?? "Speichern fehlgeschlagen.");
    }
  };

  const handleDeleteExisting = async (id: number) => {
    if (!window.confirm("Diese Markierung endgültig entfernen?")) return;
    setDeletingId(id);
    const res = await deletePdfHighlightAction(id);
    setDeletingId(null);
    if (res.ok) {
      onDeleted();
      await loadPage(); // Canvas + Liste neu laden, damit die Löschung sichtbar wird.
    } else {
      setSaveError("Löschen fehlgeschlagen.");
    }
  };

  // PDF-Rechteck (zoom-stabil gespeichert) für die aktuelle Zoomstufe auf
  // Canvas-Pixel umrechnen.
  const toCanvasRect = (r: { pdfX: number; pdfY: number; pdfWidth: number; pdfHeight: number }) => {
    if (!viewport) return { left: 0, top: 0, width: 0, height: 0 };
    const [vx1, vy1] = viewport.convertToViewportPoint(r.pdfX, r.pdfY);
    const [vx2, vy2] = viewport.convertToViewportPoint(r.pdfX + r.pdfWidth, r.pdfY + r.pdfHeight);
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
          <div className="ml-2 flex items-center gap-1 border-l border-gray-200 pl-3">
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
          <span className="text-xs text-gray-400">Mit der Maus über den Text ziehen, um zu markieren.</span>
        </div>

        <div ref={containerRef} className="min-h-0 flex-1 overflow-auto bg-gray-100 p-3">
          {loadError && <p className="p-4 text-sm text-rose-600">{loadError}</p>}
          {loading && !loadError && <p className="p-4 text-sm text-gray-500">Seite wird geladen …</p>}
          <div className="relative inline-block touch-none select-none">
            <canvas ref={canvasRef} className="block" />
            {/* Bereits gespeicherte Markierungen sind schon Teil des gerenderten
                Bilds (in der Anzeige-Datei eingezeichnet) – hier keine zweite
                Überlagerung, nur die neuen (noch nicht gespeicherten). */}
            {rects.map((r, i) => {
              const box = toCanvasRect(r);
              return (
                <div
                  key={i}
                  style={{ ...box, backgroundColor: markerColorHex(r.color), opacity: 0.35 }}
                  className="pointer-events-none absolute"
                />
              );
            })}
            {previewRect && (
              <div
                style={{ ...previewRect, backgroundColor: markerColorHex(color), opacity: 0.35 }}
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

        {(existing.length > 0 || rects.length > 0) && (
          <div className="flex max-h-36 flex-col gap-1.5 overflow-y-auto border-t border-gray-200 px-4 py-2">
            {existing.map((h) => (
              <div key={`existing-${h.id}`} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: markerColorHex(h.color) }} />
                <span className="min-w-0 flex-1 truncate text-xs text-gray-500" title={h.note ?? undefined}>
                  {h.note ? h.note : <em className="not-italic text-gray-400">Ohne Notiz</em>}
                  {h.createdByName ? ` · ${h.createdByName}` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => handleDeleteExisting(h.id)}
                  disabled={deletingId === h.id}
                  title="Markierung endgültig entfernen"
                  className="shrink-0 text-gray-400 transition-colors hover:text-rose-600 disabled:opacity-40"
                >
                  {deletingId === h.id ? "…" : "✕"}
                </button>
              </div>
            ))}
            {rects.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: markerColorHex(r.color) }} />
                <input
                  type="text"
                  value={r.note}
                  onChange={(e) => setRectNote(i, e.target.value)}
                  placeholder={`Notiz zu Markierung ${i + 1} (optional, wird durchsuchbar)`}
                  className="min-w-0 flex-1 border border-line px-2 py-1 text-xs outline-none focus:border-brand-red/60"
                />
                <button
                  type="button"
                  onClick={() => removeRect(i)}
                  title="Entfernen"
                  className="shrink-0 text-gray-400 transition-colors hover:text-rose-600"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-gray-200 px-4 py-3">
          <span className="text-xs text-gray-500">
            {rects.length > 0 ? `${rects.length} neue Markierung(en) bereit zum Speichern` : "Noch keine neue Markierung gezogen."}
          </span>
          <div className="flex items-center gap-2">
            {saveError && <span className="text-xs text-rose-600">{saveError}</span>}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              {rects.length > 0 ? "Abbrechen" : "Schließen"}
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
