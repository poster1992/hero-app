"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Live-Barcode-/QR-Scanner über die (hintere) Gerätekamera.
 * Nutzt @zxing/browser (dynamischer Import, nur clientseitig).
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
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    const last = { code: "", t: 0 };

    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
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
        if (cancelled) stop();
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
    };
  }, []);

  return (
    <div className="mt-2 rounded-md border border-gray-300 bg-black/90 p-2">
      <div className="relative overflow-hidden rounded">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} className="h-56 w-full rounded bg-black object-cover" muted playsInline autoPlay />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-24 w-4/5 rounded-lg border-2 border-white/80" />
        </div>
      </div>
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
