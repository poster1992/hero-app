"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface KontoauszugPdfViewerHandle {
  scrollToPage: (page: number) => void;
}

/**
 * Eigener scrollbarer PDF-Viewer (pdfjs-dist) statt eines nativen Browser-
 * iframes: nur damit lässt sich erkennen, welche Seite gerade sichtbar ist
 * (ein natives iframe gibt seine Scroll-Position nicht nach außen). Seiten
 * werden erst kurz vor dem Sichtbarwerden gerendert (Performance bei langen
 * Sammel-Dateien); alle Seiten teilen sich zunächst eine angenommene
 * Standardgröße (von Seite 1) als Platzhalter, damit die Scrollposition
 * stabil bleibt, bevor die jeweilige Seite tatsächlich gerendert ist.
 */
const KontoauszugPdfViewer = forwardRef<
  KontoauszugPdfViewerHandle,
  { reloadKey: string; onPageChange: (page: number) => void }
>(function KontoauszugPdfViewer({ reloadKey, onPageChange }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docRef = useRef<any>(null);
  const scaleRef = useRef(1);
  const renderedRef = useRef<Set<number>>(new Set());
  const renderObserverRef = useRef<IntersectionObserver | null>(null);
  const activeObserverRef = useRef<IntersectionObserver | null>(null);
  const visibleRatios = useRef<Map<number, number>>(new Map());
  const [numPages, setNumPages] = useState(0);
  const [defaultSize, setDefaultSize] = useState<{ width: number; height: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    scrollToPage(page: number) {
      pageRefs.current.get(page)?.scrollIntoView({ block: "start" });
    },
  }));

  const renderPage = async (page: number) => {
    if (renderedRef.current.has(page)) return;
    const doc = docRef.current;
    if (!doc) return;
    renderedRef.current.add(page);
    try {
      const proxy = await doc.getPage(page);
      const viewport = proxy.getViewport({ scale: scaleRef.current });
      const canvas = canvasRefs.current.get(page);
      const wrapper = pageRefs.current.get(page);
      if (!canvas) {
        renderedRef.current.delete(page);
        return;
      }
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      if (wrapper) {
        wrapper.style.width = `${viewport.width}px`;
        wrapper.style.height = `${viewport.height}px`;
      }
      await proxy.render({ canvas, viewport }).promise;
    } catch {
      renderedRef.current.delete(page);
    }
  };

  // PDF laden + Standard-Seitengröße (von Seite 1) ermitteln.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNumPages(0);
    setDefaultSize(null);
    renderedRef.current = new Set();

    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const doc = await pdfjsLib.getDocument({ url: "/api/kontoauszug-datei" }).promise;
        if (cancelled) return;
        docRef.current = doc;
        const firstPage = await doc.getPage(1);
        if (cancelled) return;
        const base = firstPage.getViewport({ scale: 1 });
        const containerWidth = Math.max(320, (containerRef.current?.clientWidth || 900) - 24);
        const scale = containerWidth / base.width;
        scaleRef.current = scale;
        const viewport = firstPage.getViewport({ scale });
        setDefaultSize({ width: viewport.width, height: viewport.height });
        setNumPages(doc.numPages);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "PDF konnte nicht geladen werden.");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Zwei getrennte Observer: einer mit Puffer fürs vorausschauende Rendern,
  // einer ohne Puffer, um zuverlässig die tatsächlich sichtbarste Seite zu
  // ermitteln (mit Puffer würde eine noch unsichtbare, aber vollständig im
  // Vorlade-Bereich liegende Seite fälschlich als "sichtbarste" gelten).
  useEffect(() => {
    if (numPages === 0) return;
    const container = containerRef.current;
    if (!container) return;

    const renderObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const page = Number((entry.target as HTMLElement).dataset.page);
          if (page) void renderPage(page);
        }
      },
      { root: container, rootMargin: "800px 0px", threshold: 0 }
    );

    visibleRatios.current = new Map();
    const activeObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.page);
          if (!page) continue;
          if (entry.isIntersecting) visibleRatios.current.set(page, entry.intersectionRatio);
          else visibleRatios.current.delete(page);
        }
        let best = 0;
        let bestRatio = -1;
        for (const [p, r] of visibleRatios.current) {
          if (r > bestRatio) {
            bestRatio = r;
            best = p;
          }
        }
        if (best > 0) onPageChange(best);
      },
      { root: container, rootMargin: "0px", threshold: [0, 0.25, 0.5, 0.75, 1] }
    );

    renderObserverRef.current = renderObserver;
    activeObserverRef.current = activeObserver;
    for (const el of pageRefs.current.values()) {
      renderObserver.observe(el);
      activeObserver.observe(el);
    }
    return () => {
      renderObserver.disconnect();
      activeObserver.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages]);

  const registerPageRef = (page: number) => (el: HTMLDivElement | null) => {
    if (el) {
      el.dataset.page = String(page);
      pageRefs.current.set(page, el);
      renderObserverRef.current?.observe(el);
      activeObserverRef.current?.observe(el);
    } else {
      pageRefs.current.delete(page);
    }
  };

  return (
    <div ref={containerRef} className="h-full min-h-[70vh] w-full overflow-y-auto bg-gray-200 md:min-h-0">
      {error && <p className="p-4 text-sm text-rose-600">{error}</p>}
      {loading && !error && <p className="p-4 text-sm text-gray-500">Wird geladen …</p>}
      {!loading && !error && (
        <div className="flex flex-col items-center gap-3 py-3">
          {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
            <div
              key={n}
              ref={registerPageRef(n)}
              className="bg-white shadow"
              style={defaultSize ? { width: defaultSize.width, height: defaultSize.height } : undefined}
            >
              <canvas
                ref={(el) => {
                  if (el) canvasRefs.current.set(n, el);
                  else canvasRefs.current.delete(n);
                }}
                className="block"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export default KontoauszugPdfViewer;
