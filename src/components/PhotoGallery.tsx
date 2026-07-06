"use client";

import { useEffect, useState } from "react";
import type { ProjectPhoto } from "@/lib/hero-api";

const dateFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });
const dateTimeFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

function fmtDate(iso: string | null, withTime = false): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return (withTime ? dateTimeFmt : dateFmt).format(d);
}

export default function PhotoGallery({ photos }: { photos: ProjectPhoto[] }) {
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") setOpen((i) => (i === null ? i : (i + 1) % photos.length));
      if (e.key === "ArrowLeft") setOpen((i) => (i === null ? i : (i - 1 + photos.length) % photos.length));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, photos.length]);

  const current = open === null ? null : photos[open];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {photos.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setOpen(i)}
            className="group relative aspect-square overflow-hidden rounded-lg border border-gray-300 bg-black/20 text-left"
            title={p.filename}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.thumbUrl}
              alt={p.filename}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
            />
            {/* Datum + Uploader direkt sichtbar (Overlay unten). */}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-2 pb-1.5 pt-6 text-[11px] leading-tight text-white">
              {p.created && <div>📅 {fmtDate(p.created)}</div>}
              {p.uploaderName && <div className="truncate">👤 {p.uploaderName}</div>}
            </div>
          </button>
        ))}
      </div>

      {current && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setOpen(null)}
        >
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20"
            aria-label="Schließen"
          >
            ✕
          </button>
          {photos.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen((i) => (i === null ? i : (i - 1 + photos.length) % photos.length));
                }}
                className="absolute left-4 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-3xl text-white hover:bg-white/20"
                aria-label="Vorheriges"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen((i) => (i === null ? i : (i + 1) % photos.length));
                }}
                className="absolute right-4 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-3xl text-white hover:bg-white/20"
                aria-label="Nächstes"
              >
                ›
              </button>
            </>
          )}
          <div className="flex max-h-full max-w-full flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.fullUrl}
              alt={current.filename}
              className="max-h-[80vh] max-w-full rounded-lg object-contain"
            />
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-white/80">
              <span className="font-medium text-white">{current.filename}</span>
              {current.created && <span>📅 {fmtDate(current.created, true)}</span>}
              {current.uploaderName && <span>👤 {current.uploaderName}</span>}
              <a
                href={current.fullUrl}
                target="_blank"
                rel="noopener noreferrer"
                download={current.filename}
                className="rounded-md bg-white/10 px-3 py-1 font-medium text-white hover:bg-white/20"
              >
                Herunterladen
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
