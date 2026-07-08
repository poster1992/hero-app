"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getProjectDocuments, type ProjectDocument } from "@/app/dashboard/projekte/receipts-actions";

/** Kleines Datei-Icon je nach Dateiendung/Typ. */
function fileIcon(name: string, type: string | null): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const t = type ?? "";
  if (t.includes("pdf") || ext === "pdf") return "📕";
  if (t.includes("word") || ext === "doc" || ext === "docx") return "📘";
  if (t.includes("sheet") || t.includes("excel") || ext === "xls" || ext === "xlsx" || ext === "csv") return "📗";
  if (t.includes("zip") || ext === "zip" || ext === "rar") return "🗜️";
  if (ext === "txt") return "📄";
  return "📄";
}

export default function ProjectDocumentsButton({ projectId }: { projectId: number }) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<ProjectDocument[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => setMounted(true), []);

  // Beim Öffnen laden (nur einmal).
  useEffect(() => {
    if (!open || docs !== null) return;
    setLoading(true);
    getProjectDocuments(projectId)
      .then(setDocs)
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, [open, docs, projectId]);

  // Esc schließt; Scroll sperren.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const panel = open && (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
      <div
        className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-3">
          <h3 className="text-sm font-medium text-gray-900">
            Dokumente zum Projekt{docs ? ` · ${docs.length}` : ""}
          </h3>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-brand-red/50 hover:text-brand-red"
          >
            Schließen ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="py-10 text-center text-sm text-gray-400">Dokumente werden geladen …</p>
          ) : !docs || docs.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">Keine Dokumente zu diesem Projekt.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {docs.map((d, i) => (
                <li key={i}>
                  <div className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 transition-colors hover:border-brand-red/40 hover:bg-gray-50">
                    <span className="text-lg" aria-hidden>
                      {fileIcon(d.filename, d.type)}
                    </span>
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Öffnen"
                      className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 hover:text-brand-red hover:underline"
                    >
                      {d.filename}
                    </a>
                    <a
                      href={d.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Herunterladen"
                      className="shrink-0 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 transition-colors hover:border-brand-red/50 hover:text-brand-red"
                    >
                      ↓
                    </a>
                  </div>
                </li>
              ))}
            </ul>
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
        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
      >
        📄 Dokumente
      </button>
      {mounted && panel && createPortal(panel, document.body)}
    </>
  );
}
