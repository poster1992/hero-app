"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getProjectPhotos, type ProjectPhoto } from "@/app/dashboard/projekte/receipts-actions";

const photoDateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
function fmtPhotoDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : photoDateFmt.format(d);
}

export default function ProjectPhotosButton({ projectId }: { projectId: number }) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<ProjectPhoto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => setMounted(true), []);

  // Beim Öffnen laden (nur einmal).
  useEffect(() => {
    if (!open || photos !== null) return;
    setLoading(true);
    getProjectPhotos(projectId)
      .then(setPhotos)
      .catch(() => setPhotos([]))
      .finally(() => setLoading(false));
  }, [open, photos, projectId]);

  // Tastatur: Esc schließt Lightbox bzw. Galerie; Pfeile blättern.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (lightbox !== null) setLightbox(null);
        else setOpen(false);
      } else if (lightbox !== null && photos && photos.length > 0) {
        if (e.key === "ArrowRight") setLightbox((i) => ((i ?? 0) + 1) % photos.length);
        if (e.key === "ArrowLeft") setLightbox((i) => ((i ?? 0) - 1 + photos.length) % photos.length);
      }
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, lightbox, photos]);

  const gallery = open && (
    <div
      className="fixed inset-0 z-[110] flex flex-col bg-black/90"
      onClick={() => setOpen(false)}
    >
      {/* Kopf */}
      <div
        className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-3 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-medium">
          Fotos zum Projekt{photos ? ` · ${photos.length}` : ""}
        </h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/10"
        >
          Schließen ✕
        </button>
      </div>

      {/* Raster */}
      <div className="flex-1 overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
        {loading ? (
          <p className="py-10 text-center text-sm text-white/70">Fotos werden geladen …</p>
        ) : !photos || photos.length === 0 ? (
          <p className="py-10 text-center text-sm text-white/70">Keine Fotos zu diesem Projekt.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {photos.map((ph, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setLightbox(i)}
                title={`${ph.filename}${ph.uploadedAt ? ` · ${fmtPhotoDate(ph.uploadedAt)}` : ""}${
                  ph.uploadedBy ? ` · ${ph.uploadedBy}` : ""
                }`}
                className="group relative overflow-hidden rounded-md bg-white/5"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ph.thumbUrl}
                  alt={ph.filename}
                  loading="lazy"
                  className="h-32 w-full object-cover transition-transform group-hover:scale-105"
                />
                {(ph.uploadedAt || ph.uploadedBy) && (
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-left text-[10px] font-medium text-white">
                    {fmtPhotoDate(ph.uploadedAt)}
                    {ph.uploadedAt && ph.uploadedBy ? " · " : ""}
                    {ph.uploadedBy ?? ""}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox (Vollbild) */}
      {lightbox !== null && photos && photos[lightbox] && (
        <div
          className="absolute inset-0 z-[120] flex flex-col bg-black/95"
          onClick={() => setLightbox(null)}
        >
          <div
            className="flex items-center justify-between gap-3 px-5 py-3 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="truncate text-sm">
              {photos[lightbox].filename}
              {photos[lightbox].uploadedAt ? ` · ${fmtPhotoDate(photos[lightbox].uploadedAt)}` : ""}
              {photos[lightbox].uploadedBy ? ` · ${photos[lightbox].uploadedBy}` : ""} ·{" "}
              {lightbox + 1}/{photos.length}
            </span>
            <div className="flex items-center gap-2">
              <a
                href={photos[lightbox].downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-white/20 px-3 py-1.5 text-xs text-white hover:bg-white/10"
              >
                Original ↗
              </a>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="rounded-md border border-white/20 px-3 py-1.5 text-xs text-white hover:bg-white/10"
              >
                ✕
              </button>
            </div>
          </div>
          <div
            className="relative flex flex-1 items-center justify-center overflow-hidden p-2"
            onClick={(e) => e.stopPropagation()}
          >
            {photos.length > 1 && (
              <button
                type="button"
                onClick={() => setLightbox((i) => ((i ?? 0) - 1 + photos.length) % photos.length)}
                className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-xl text-white hover:bg-white/20"
                aria-label="Vorheriges Foto"
              >
                ‹
              </button>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photos[lightbox].fullUrl}
              alt={photos[lightbox].filename}
              className="max-h-full max-w-full object-contain"
            />
            {photos.length > 1 && (
              <button
                type="button"
                onClick={() => setLightbox((i) => ((i ?? 0) + 1) % photos.length)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-xl text-white hover:bg-white/20"
                aria-label="Nächstes Foto"
              >
                ›
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
      >
        📷 Fotos
      </button>
      {mounted && gallery && createPortal(gallery, document.body)}
    </>
  );
}
