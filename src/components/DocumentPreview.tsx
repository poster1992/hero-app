"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface DocumentPreviewProps {
  filename: string;
  /** Proxy URL that streams the full document (PDF/image). */
  docUrl: string;
  /** Small thumbnail for the table trigger. */
  thumbnailUrl: string | null;
  /** Larger thumbnail used as a fallback preview image. */
  previewUrl: string | null;
  mimeType: string | null;
}

export default function DocumentPreview({
  filename,
  docUrl,
  thumbnailUrl,
  previewUrl,
  mimeType,
}: DocumentPreviewProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const isPdf = (mimeType ?? "").includes("pdf") || filename.toLowerCase().endsWith(".pdf");

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const modal = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-gray-800 px-5 py-3">
          <p className="truncate text-sm font-medium text-gray-100" title={filename}>
            {filename}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={docUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-brand-red/50 hover:text-brand-red"
            >
              In neuem Tab öffnen
            </a>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-gray-500 hover:text-gray-100"
            >
              Schließen
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-white">
          {isPdf ? (
            <object data={docUrl} type="application/pdf" className="h-full w-full">
              <iframe src={docUrl} title={filename} className="h-full w-full border-0" />
            </object>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl ?? docUrl}
              alt={filename}
              className="mx-auto max-h-full w-auto object-contain"
            />
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Vorschau: ${filename}`}
        className="block shrink-0 rounded-sm ring-1 ring-gray-300 transition hover:ring-brand-red/60"
      >
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnailUrl} alt="" className="h-9 w-7 rounded-sm object-cover" />
        ) : (
          <span className="flex h-9 w-7 items-center justify-center rounded-sm bg-brand-red/15 text-[10px] font-bold text-brand-red">
            PDF
          </span>
        )}
      </button>

      {open && mounted && createPortal(modal, document.body)}
    </>
  );
}
