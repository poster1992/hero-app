"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  getProjectDocuments,
  getProjectDocumentFolders,
  uploadProjectDocumentAction,
  type ProjectDocumentFolder,
} from "@/app/dashboard/projekte/receipts-actions";
import type { HeroFolder } from "@/lib/hero-api";

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
  const [folders, setFolders] = useState<ProjectDocumentFolder[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Aufgeklappte Ordner (beim ersten Laden ist der erste Ordner offen).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Upload
  const [heroFolders, setHeroFolders] = useState<HeroFolder[]>([]);
  const [targetFolder, setTargetFolder] = useState<number | "">("");
  const [uploading, startUpload] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  /** Dokumente (neu) laden. */
  const load = () =>
    getProjectDocuments(projectId)
      .then((f) => {
        setFolders(f);
        setExpanded((prev) => (prev.size > 0 ? prev : new Set(f.slice(0, 1).map((x) => x.name))));
      })
      .catch(() => setFolders([]));

  // Beim Öffnen laden (nur einmal): Dokumente + die HERO-Ordnerliste für den Upload.
  useEffect(() => {
    if (!open || folders !== null) return;
    setLoading(true);
    Promise.all([load(), getProjectDocumentFolders().then(setHeroFolders).catch(() => setHeroFolders([]))]).finally(
      () => setLoading(false)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, folders, projectId]);

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

  const toggleFolder = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  function onFiles(list: FileList | null) {
    if (!list || list.length === 0 || targetFolder === "") return;
    const files = Array.from(list);
    const folderName = heroFolders.find((f) => f.id === targetFolder)?.name ?? "";
    setStatus(null);

    startUpload(async () => {
      const fd = new FormData();
      fd.append("projectId", String(projectId));
      fd.append("folderId", String(targetFolder));
      for (const f of files) fd.append("files", f);

      const res = await uploadProjectDocumentAction(fd);
      if (!res.ok) {
        setStatus({ ok: false, text: res.error ?? "Upload fehlgeschlagen." });
      } else {
        setStatus({
          ok: true,
          text:
            `${res.uploaded === 1 ? "1 Dokument" : `${res.uploaded} Dokumente`} in „${folderName}" abgelegt` +
            (res.error ? ` – ${res.error}` : ""),
        });
        // Ordner frisch laden und den Ziel-Ordner aufklappen.
        await load();
        setExpanded((prev) => new Set(prev).add(folderName));
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  const total = folders?.reduce((n, f) => n + f.documents.length, 0) ?? 0;

  const panel = open && (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-3">
          <h3 className="text-sm font-medium text-gray-900">
            Dokumente zum Projekt{folders ? ` · ${total}` : ""}
          </h3>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-brand-red/50 hover:text-brand-red"
          >
            Schließen ✕
          </button>
        </div>

        {/* Hochladen: Ordner wählen, dann Datei(en) */}
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50 px-5 py-3">
          <select
            value={targetFolder}
            onChange={(e) => setTargetFolder(e.target.value === "" ? "" : Number(e.target.value))}
            disabled={uploading || heroFolders.length === 0}
            className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 disabled:opacity-60"
          >
            <option value="">Ordner wählen …</option>
            {heroFolders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>

          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading || targetFolder === ""}
            title={targetFolder === "" ? "Zuerst einen Ordner wählen" : "Dokument(e) in diesen Ordner hochladen"}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-brand-red px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="text-sm leading-none">＋</span>
            {uploading ? "Lädt hoch …" : "Datei"}
          </button>
        </div>

        {status && (
          <p
            className={`px-5 py-2 text-xs ${status.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}
          >
            {status.ok ? "✅" : "⚠️"} {status.text}
          </p>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="py-10 text-center text-sm text-gray-400">Dokumente werden geladen …</p>
          ) : !folders || folders.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">Keine Dokumente zu diesem Projekt.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {folders.map((folder) => {
                const isOpen = expanded.has(folder.name);
                return (
                  <li key={folder.name} className="overflow-hidden rounded-lg border border-gray-200">
                    <button
                      type="button"
                      onClick={() => toggleFolder(folder.name)}
                      className="flex w-full items-center gap-2 bg-gray-50 px-3 py-2 text-left transition-colors hover:bg-gray-100"
                    >
                      <span className="w-3 text-xs text-gray-500" aria-hidden>
                        {isOpen ? "▾" : "▸"}
                      </span>
                      <span aria-hidden>{isOpen ? "📂" : "📁"}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                        {folder.name}
                      </span>
                      <span className="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">
                        {folder.documents.length}
                      </span>
                    </button>

                    {isOpen && (
                      <ul className="flex flex-col gap-1 p-2">
                        {folder.documents.map((d, i) => (
                          <li
                            key={`${folder.name}-${i}`}
                            className="flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-gray-50"
                          >
                            <span className="text-lg" aria-hidden>
                              {fileIcon(d.filename, d.type)}
                            </span>
                            <a
                              href={d.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Öffnen"
                              className="min-w-0 flex-1 truncate text-sm text-gray-900 hover:text-brand-red hover:underline"
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
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
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
