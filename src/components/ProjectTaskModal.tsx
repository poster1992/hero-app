"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { listAssignableUsers } from "@/app/dashboard/logbook-actions";
import { createTaskAction } from "@/app/dashboard/aufgaben/actions";

/** Pop-up zum schnellen Erstellen einer Aufgabe für ein Projekt. */
export default function ProjectTaskModal({
  projectId,
  projectRelativeId = null,
  projectName,
  onClose,
}: {
  projectId: number;
  projectRelativeId?: number | null;
  projectName: string;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [users, setUsers] = useState<{ id: number; name: string }[] | null>(null);
  const [assignee, setAssignee] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    listAssignableUsers()
      .then((u) => !cancelled && setUsers(u))
      .catch(() => !cancelled && setUsers([]));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!assignee) return setMsg({ ok: false, text: "Bitte einen Mitarbeiter wählen." });
    if (!title.trim()) return setMsg({ ok: false, text: "Bitte einen Titel angeben." });
    if (!dueDate) return setMsg({ ok: false, text: "Bitte ein Fälligkeitsdatum angeben." });
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("title", title.trim());
      if (desc.trim()) fd.set("description", desc.trim());
      fd.append("assignedTo", String(assignee));
      fd.set("dueDate", dueDate);
      fd.set("projectId", String(projectId));
      if (projectRelativeId != null) fd.set("projectRelativeId", String(projectRelativeId));
      fd.set("projectName", projectName);
      const res = await createTaskAction({}, fd);
      if (res.error) {
        setMsg({ ok: false, text: res.error });
      } else {
        setMsg({ ok: true, text: "Aufgabe zugewiesen ✅" });
        setTimeout(onClose, 800);
      }
    } catch {
      setMsg({ ok: false, text: "Aufgabe konnte nicht erstellt werden." });
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) return null;

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60";

  const modal = (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-gray-300 bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">Aufgabe erstellen</h2>
            <p className="truncate text-sm text-gray-500">
              Projekt: {projectRelativeId != null ? `#${projectRelativeId} ` : ""}
              {projectName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="text-gray-400 transition-colors hover:text-gray-700"
          >
            ✕
          </button>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-sm text-gray-600">An Mitarbeiter *</label>
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value ? Number(e.target.value) : "")}
              required
              className={inputClass}
            >
              <option value="">Mitarbeiter wählen …</option>
              {(users ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Titel *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Was ist zu tun?"
              className={inputClass}
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Beschreibung</label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              placeholder="Details …"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Fällig bis *</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={inputClass}
            />
          </div>
          {msg && (
            <p className={`text-sm ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Weist zu …" : "Aufgabe zuweisen"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
