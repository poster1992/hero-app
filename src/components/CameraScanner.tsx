"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Live-Barcode-/QR-Scanner über die (hintere) Gerätekamera.
 * Nutzt @zxing/browser (dynamischer Import, nur clientseitig).
 *
 * Für größere Scan-Entfernung:
 *  - hohe Kamera-Auflösung (mehr Pixel pro Barcode),
 *  - Zoom-Regler (optischer/digitaler Zoom, falls das Gerät ihn unterstützt),
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
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

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
            setZoom({ min: caps.zoom.min, max: caps.zoom.max, step });
            setZoomValue(settings.zoom ?? caps.zoom.min);
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
      trackRef.current = null;
    };
  }, []);

  async function applyZoom(value: number) {
    setZoomValue(value);
    const track = trackRef.current;
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ zoom: value }] } as unknown as MediaTrackConstraints);
    } catch {
      /* Zoom optional */
    }
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
    <div className="mt-2 rounded-md border border-gray-300 bg-black/90 p-2">
      <div className="relative overflow-hidden rounded">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} className="h-64 w-full rounded bg-black object-cover" muted playsInline autoPlay />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-24 w-4/5 rounded-lg border-2 border-white/80" />
        </div>
        {/* Taschenlampe oben rechts (falls unterstützt) */}
        {torchSupported && (
          <button
            type="button"
            onClick={toggleTorch}
            aria-label={torchOn ? "Taschenlampe aus" : "Taschenlampe an"}
            className={`absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full text-lg shadow ${
              torchOn ? "bg-amber-400 text-gray-900" : "bg-black/50 text-white hover:bg-black/70"
            }`}
          >
            🔦
          </button>
        )}
      </div>

      {/* Zoom-Regler für entfernte Barcodes */}
      {zoom && (
        <div className="mt-2 flex items-center gap-2 px-1">
          <span className="text-xs text-white/70">Zoom</span>
          <input
            type="range"
            min={zoom.min}
            max={zoom.max}
            step={zoom.step}
            value={zoomValue}
            onChange={(e) => applyZoom(Number(e.target.value))}
            className="h-1.5 w-full cursor-pointer accent-emerald-400"
          />
          <span className="w-10 text-right text-xs tabular-nums text-white/70">
            {zoomValue.toFixed(1)}×
          </span>
        </div>
      )}

      {starting && !error && <p className="mt-1 text-center text-xs text-white/70">Kamera wird gestartet …</p>}
      {error && <p className="mt-1 text-center text-xs text-rose-300">{error}</p>}
      {feedback && (
        <p className={`mt-1 text-center text-sm font-medium ${feedback.ok ? "text-emerald-300" : "text-rose-300"}`}>
          {feedback.text}
        </p>
      )}
      <div className="mt-2 flex justify-center">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-white/90 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-white"
        >
          Kamera schließen
        </button>
      </div>
    </div>
  );
}
