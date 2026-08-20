"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Live-Barcode-/QR-Scanner über die (hintere) Gerätekamera.
 * Nutzt @zxing/browser (dynamischer Import, nur clientseitig).
 *
 * Für größere Scan-Entfernung:
 *  - hohe Kamera-Auflösung (mehr Pixel pro Barcode),
 *  - Auto-Zoom: fährt automatisch heran, bis ein Code erkannt wird, und öffnet
 *    danach wieder auf (für den nächsten Artikel); optional manuell per Regler,
 *  - Taschenlampe (Torch) für schlechte Lichtverhältnisse,
 *  - kontinuierlicher Autofokus,
 *  - ZXing „TRY_HARDER" (gründlichere, aber langsamere Erkennung).
 */
export default function CameraScanner({
  onDetect,
  onClose,
  feedback,
}: {
  onDetect: (code: string) => void;
  onClose: () => void;
  feedback?: { ok: boolean; text: string } | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;
  const trackRef = useRef<MediaStreamTrack | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  // Zoom-/Torch-Fähigkeiten des Geräts (nicht überall vorhanden).
  const [zoom, setZoom] = useState<{ min: number; max: number; step: number } | null>(null);
  const [zoomValue, setZoomValue] = useState(1);
  const [autoZoom, setAutoZoom] = useState(true);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  // Refs, damit der Auto-Zoom-Timer immer aktuelle Werte sieht (ohne Neustart).
  const zoomCapsRef = useRef<{ min: number; max: number; step: number } | null>(null);
  const zoomValueRef = useRef(1);
  const autoZoomRef = useRef(true);
  const lastDetectRef = useRef(0);
  const zoomTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setZoomState = (v: number) => {
    zoomValueRef.current = v;
    setZoomValue(v);
  };

  async function applyZoom(value: number) {
    setZoomState(value);
    const track = trackRef.current;
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ zoom: value }] } as unknown as MediaTrackConstraints);
    } catch {
      /* Zoom optional */
    }
  }

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    const last = { code: "", t: 0 };

    (async () => {
      try {
        const [{ BrowserMultiFormatReader }, zxingLib] = await Promise.all([
          import("@zxing/browser"),
          import("@zxing/library"),
        ]);
        // Gründlichere Erkennung (hilft bei kleinen/entfernten Codes).
        const hints = new Map();
        hints.set(zxingLib.DecodeHintType.TRY_HARDER, true);
        const reader = new BrowserMultiFormatReader(hints);

        const controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: "environment" },
              // Höhere Auflösung → entfernte Barcodes haben mehr Details.
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          },
          videoRef.current!,
          (result) => {
            if (!result) return;
            const text = result.getText();
            const now = Date.now();
            lastDetectRef.current = now;
            // Gleichen Code nicht mehrfach in kurzer Folge übernehmen.
            if (text === last.code && now - last.t < 1500) return;
            last.code = text;
            last.t = now;
            if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(60);
            onDetectRef.current(text);
          }
        );
        stop = () => controls.stop();
        if (cancelled) {
          stop();
          return;
        }

        // Kamera-Track holen und Zoom/Torch/Fokus-Fähigkeiten auslesen.
        const stream = videoRef.current?.srcObject as MediaStream | null;
        const track = stream?.getVideoTracks?.()[0] ?? null;
        trackRef.current = track ?? null;
        if (track && typeof track.getCapabilities === "function") {
          // Zoom/Torch/focusMode sind (noch) nicht im TS-Typ enthalten → any.
          const caps = track.getCapabilities() as unknown as {
            zoom?: { min: number; max: number; step: number };
            torch?: boolean;
            focusMode?: string[];
          };
          const settings = track.getSettings() as unknown as { zoom?: number };

          if (caps.zoom && typeof caps.zoom.max === "number" && caps.zoom.max > (caps.zoom.min ?? 1)) {
            const step = caps.zoom.step && caps.zoom.step > 0 ? caps.zoom.step : 0.1;
            const capsObj = { min: caps.zoom.min, max: caps.zoom.max, step };
            zoomCapsRef.current = capsObj;
            setZoom(capsObj);
            setZoomState(settings.zoom ?? caps.zoom.min);

            // Auto-Zoom-Schleife: fährt langsam heran, bis etwas erkannt wird,
            // und öffnet nach einem Treffer wieder auf den kleinsten Zoom.
            zoomTimerRef.current = setInterval(() => {
              const c = zoomCapsRef.current;
              const trk = trackRef.current;
              if (!c || !trk || !autoZoomRef.current) return;
              const cur = zoomValueRef.current;
              const span = c.max - c.min;
              const ramp = Math.max(c.step, span / 12); // ~12 Schritte von min → max
              const sinceDetect = Date.now() - lastDetectRef.current;
              // Gerade erkannt → wieder aufmachen (nächster Artikel evtl. näher).
              const target = sinceDetect < 1300 ? c.min : Math.min(c.max, cur + ramp);
              if (Math.abs(target - cur) >= c.step * 0.5) {
                applyZoom(target);
              }
            }, 600);
          }
          if (caps.torch) setTorchSupported(true);

          // Kontinuierlichen Autofokus aktivieren, falls verfügbar.
          if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
            try {
              await track.applyConstraints({
                advanced: [{ focusMode: "continuous" }],
              } as unknown as MediaTrackConstraints);
            } catch {
              /* Fokus-Modus optional */
            }
          }
        }

        setStarting(false);
      } catch (e) {
        setError(
          e instanceof Error && e.name === "NotAllowedError"
            ? "Kamera-Zugriff wurde abgelehnt. Bitte im Browser erlauben."
            : e instanceof Error
              ? e.message
              : "Kamera konnte nicht gestartet werden."
        );
        setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
      stop?.();
      if (zoomTimerRef.current) clearInterval(zoomTimerRef.current);
      trackRef.current = null;
    };
  }, []);

  function toggleAutoZoom() {
    const next = !autoZoom;
    autoZoomRef.current = next;
    setAutoZoom(next);
  }

  function onManualZoom(value: number) {
    // Manuelles Ziehen schaltet Auto-Zoom aus.
    if (autoZoomRef.current) {
      autoZoomRef.current = false;
      setAutoZoom(false);
    }
    applyZoom(value);
  }

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints);
      setTorchOn(next);
    } catch {
      /* Torch optional */
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black">
      {/* Vollbild-Kamerabild */}
      <div className="relative flex-1 overflow-hidden">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} className="h-full w-full bg-black object-cover" muted playsInline autoPlay />

        {/* Quadratischer Zielrahmen, mittig */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="aspect-square w-64 max-w-[80vw] rounded-xl border-2 border-white/85 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>

        {/* Schließen oben links (Safe-Area) */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Kamera schließen"
          className="absolute left-4 flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-xl text-white hover:bg-black/75"
          style={{ top: "max(env(safe-area-inset-top), 1rem)" }}
        >
          ✕
        </button>

        {/* Taschenlampe oben rechts (falls unterstützt) */}
        {torchSupported && (
          <button
            type="button"
            onClick={toggleTorch}
            aria-label={torchOn ? "Taschenlampe aus" : "Taschenlampe an"}
            className={`absolute right-4 flex h-11 w-11 items-center justify-center rounded-full text-xl shadow ${
              torchOn ? "bg-amber-400 text-gray-900" : "bg-black/55 text-white hover:bg-black/75"
            }`}
            style={{ top: "max(env(safe-area-inset-top), 1rem)" }}
          >
            🔦
          </button>
        )}

        {/* Status/Hinweis unten über dem Bild */}
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex flex-col items-center gap-1 px-4 text-center">
          {starting && !error && <p className="text-xs text-white/80">Kamera wird gestartet …</p>}
          {error && <p className="text-sm font-medium text-rose-300">{error}</p>}
          {feedback && (
            <p className={`text-sm font-semibold ${feedback.ok ? "text-emerald-300" : "text-rose-300"}`}>
              {feedback.text}
            </p>
          )}
          {!error && !feedback && (
            <p className="text-xs text-white/70">Barcode / QR-Code anvisieren</p>
          )}
        </div>
      </div>

      {/* Bedienleiste unten (Zoom + Schließen), Safe-Area */}
      <div
        className="shrink-0 bg-black px-4 pt-3"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
      >
        {zoom && (
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={toggleAutoZoom}
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                autoZoom ? "bg-emerald-500 text-white" : "bg-white/15 text-white/80 hover:bg-white/25"
              }`}
              title="Automatisch heranzoomen, bis ein Code erkannt wird"
            >
              {autoZoom ? "Auto-Zoom ✓" : "Auto-Zoom"}
            </button>
            <input
              type="range"
              min={zoom.min}
              max={zoom.max}
              step={zoom.step}
              value={zoomValue}
              onChange={(e) => onManualZoom(Number(e.target.value))}
              className={`h-1.5 w-full cursor-pointer accent-emerald-400 ${autoZoom ? "opacity-60" : ""}`}
            />
            <span className="w-10 text-right text-xs tabular-nums text-white/70">{zoomValue.toFixed(1)}×</span>
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-lg bg-white/90 py-3 text-base font-semibold text-gray-900 hover:bg-white"
        >
          Kamera schließen
        </button>
      </div>
    </div>
  );
}
