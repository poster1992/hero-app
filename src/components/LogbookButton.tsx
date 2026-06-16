"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  getProjectLogbook,
  addLogbookEntry,
  type LogbookEntry,
} from "@/app/dashboard/logbook-actions";

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default function LogbookButton({
  projectId,
  projectName,
}: {
  projectId: number;
  projectName: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [entries, setEntries] = useState<LogbookEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  async function openLogbook() {
    setOpen(true);
    if (entries === null && !loading) {
      setLoading(true);
      try {
        setEntries(await getProjectLogbook(projectId));
      } catch {
        setEntries([]);
      } finally {
        setLoading(false);
      }
    }
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    if (!noteText.trim()) return;
    setSaving(true);
    try {
      const res = await addLogbookEntry(projectId, noteText);
      if (res.ok && res.entry) {
        setEntries((prev) => [res.entry!, ...(prev ?? [])]);
        setNoteText("");
      } else {
        setSaveError(res.message);
      }
    } finally {
      setSaving(false);
    }
  }

  const modal = (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-gray-800 px-5 py-3">
          <p className="truncate text-sm font-medium text-gray-100">Logbuch · {projectName}</p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-gray-500 hover:text-gray-100"
          >
            Schließen
          </button>
        </div>
        <div className="overflow-y-auto">
          {loading ? (
            <p className="px-5 py-8 text-center text-sm text-gray-500">Lädt…</p>
          ) : !entries || entries.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-500">Keine Einträge.</p>
          ) : (
            <ul className="divide-y divide-gray-800/60">
              {entries.map((e) => (
                <li key={e.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-gray-200">
                      {e.title || "—"}
                    </span>
                    <span className="text-xs text-gray-500">
                      {e.date ? dateFormatter.format(new Date(e.date)) : ""}
                      {e.author ? ` · ${e.author}` : ""}
                    </span>
                  </div>
                  {e.text && (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-gray-400">{e.text}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <form onSubmit={onSave} className="border-t border-gray-800 px-5 py-3">
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={2}
            placeholder="Neue Notiz im Logbuch…"
            className="w-full resize-y rounded-lg border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-brand-red focus:outline-none"
          />
          {saveError && <p className="mt-1 text-xs text-red-400">{saveError}</p>}
          <div className="mt-2 flex justify-end">
            <button
              type="submit"
              disabled={saving || !noteText.trim()}
              className="rounded-lg bg-brand-red px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-red-dark disabled:opacity-50"
            >
              {saving ? "Speichert…" : "Eintrag speichern"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={openLogbook}
        title="Logbuch öffnen"
        className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-700 text-gray-400 transition-colors hover:border-brand-red/50 hover:text-brand-red"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
          <path d="M5 4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4Z" />
          <path d="M5 7H3.5M5 12H3.5M5 17H3.5" />
          <path d="M9 8h5M9 12h5M9 16h3" />
        </svg>
      </button>

      {open && mounted && createPortal(modal, document.body)}
    </>
  );
}
