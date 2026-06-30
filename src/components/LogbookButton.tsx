"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  getProjectLogbook,
  addLogbookEntry,
  listAssignableUsers,
  type LogbookEntry,
} from "@/app/dashboard/logbook-actions";
import { createTaskAction } from "@/app/dashboard/aufgaben/actions";

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
  projectRelativeId = null,
}: {
  projectId: number;
  projectName: string;
  projectRelativeId?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [entries, setEntries] = useState<LogbookEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Aufgabe zuweisen
  const [assignOpen, setAssignOpen] = useState(false);
  const [users, setUsers] = useState<{ id: number; name: string }[] | null>(null);
  const [assignee, setAssignee] = useState<number | "">("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignMsg, setAssignMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => setMounted(true), []);

  async function toggleAssign() {
    const next = !assignOpen;
    setAssignOpen(next);
    setAssignMsg(null);
    if (next && users === null) {
      try {
        setUsers(await listAssignableUsers());
      } catch {
        setUsers([]);
      }
    }
  }

  async function onAssign(e: React.FormEvent) {
    e.preventDefault();
    setAssignMsg(null);
    if (!assignee) return setAssignMsg({ ok: false, text: "Bitte einen Mitarbeiter wählen." });
    if (!taskTitle.trim()) return setAssignMsg({ ok: false, text: "Bitte einen Titel angeben." });
    if (!dueDate) return setAssignMsg({ ok: false, text: "Bitte ein Fälligkeitsdatum angeben." });
    setAssigning(true);
    try {
      const fd = new FormData();
      fd.set("title", taskTitle.trim());
      if (taskDesc.trim()) fd.set("description", taskDesc.trim());
      fd.append("assignedTo", String(assignee));
      fd.set("dueDate", dueDate);
      fd.set("projectId", String(projectId));
      if (projectRelativeId != null) fd.set("projectRelativeId", String(projectRelativeId));
      fd.set("projectName", projectName);
      const res = await createTaskAction({}, fd);
      if (res.error) {
        setAssignMsg({ ok: false, text: res.error });
      } else {
        setAssignMsg({ ok: true, text: "Aufgabe zugewiesen ✅" });
        setTaskTitle("");
        setTaskDesc("");
        setAssignee("");
        setDueDate("");
      }
    } catch {
      setAssignMsg({ ok: false, text: "Aufgabe konnte nicht erstellt werden." });
    } finally {
      setAssigning(false);
    }
  }

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

        {/* Aufgabe für dieses Projekt zuweisen */}
        <div className="border-t border-gray-800 px-5 py-3">
          <button
            type="button"
            onClick={toggleAssign}
            className="flex items-center gap-2 text-sm font-medium text-gray-200 transition-colors hover:text-white"
          >
            <span className="text-brand-red">＋</span>
            Aufgabe zuweisen
            <span className="text-gray-500">{assignOpen ? "▲" : "▼"}</span>
          </button>
          {assignOpen && (
            <form onSubmit={onAssign} className="mt-3 flex flex-col gap-2">
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value ? Number(e.target.value) : "")}
                required
                className="w-full rounded-lg border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100 focus:border-brand-red focus:outline-none"
              >
                <option value="">Mitarbeiter wählen …</option>
                {(users ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="Titel der Aufgabe *"
                className="w-full rounded-lg border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-brand-red focus:outline-none"
              />
              <textarea
                value={taskDesc}
                onChange={(e) => setTaskDesc(e.target.value)}
                rows={2}
                placeholder="Beschreibung (optional) …"
                className="w-full resize-y rounded-lg border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-brand-red focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400">Fällig bis *</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="rounded-lg border border-gray-700 bg-gray-950/60 px-3 py-1.5 text-sm text-gray-100 focus:border-brand-red focus:outline-none"
                />
              </div>
              {assignMsg && (
                <p className={`text-xs ${assignMsg.ok ? "text-emerald-400" : "text-red-400"}`}>
                  {assignMsg.text}
                </p>
              )}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={assigning}
                  className="rounded-lg bg-brand-red px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-red-dark disabled:opacity-50"
                >
                  {assigning ? "Weist zu …" : "Aufgabe zuweisen"}
                </button>
              </div>
            </form>
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
