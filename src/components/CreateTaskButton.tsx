"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  createTaskAction,
  listTaskUsersAction,
  type CreateTaskState,
} from "@/app/dashboard/aufgaben/actions";

const initial: CreateTaskState = {};

/**
 * Kopfzeilen-Button „Aufgabe" im Projekt-Popup: öffnet ein Fenster zum Erstellen
 * einer Aufgabe, die dem Projekt zugeordnet ist. Nutzt dieselbe createTaskAction
 * wie die Aufgaben-Seite (inkl. Benachrichtigung/Logbuch).
 */
export default function CreateTaskButton({
  projectId,
  projectRelativeId,
  projectName,
}: {
  projectId: number;
  projectRelativeId: number | null;
  projectName: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<{ id: number; name: string }[] | null>(null);
  const [state, formAction, pending] = useActionState<CreateTaskState, FormData>(createTaskAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const lastSuccess = useRef<string | undefined>(undefined);

  useEffect(() => setMounted(true), []);

  // Benutzer beim Öffnen laden (einmal).
  useEffect(() => {
    if (!open || users !== null) return;
    listTaskUsersAction()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, [open, users]);

  // Nach erfolgreichem Anlegen: Formular leeren, kurz „gespeichert" zeigen, dann schließen.
  useEffect(() => {
    if (!state.success || state.success === lastSuccess.current) return;
    lastSuccess.current = state.success;
    formRef.current?.reset();
    const t = setTimeout(() => setOpen(false), 900);
    return () => clearTimeout(t);
  }, [state.success]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60";

  const modal = open && (
    <div
      className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onClick={() => setOpen(false)}
    >
      <div
        className="max-h-[85vh] w-[80vw] max-w-5xl overflow-y-auto rounded-xl border border-gray-300 bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Aufgabe erstellen</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-gray-400 transition-colors hover:text-gray-700"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>
        <p className="mb-4 text-sm text-gray-600">
          Projekt: {projectRelativeId != null ? `#${projectRelativeId} ` : ""}
          {projectName}
        </p>

        <form ref={formRef} action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="projectRelativeId" value={projectRelativeId ?? ""} />
          <input type="hidden" name="projectName" value={projectName} />

          <div>
            <label className="mb-1 block text-sm text-gray-600">Titel *</label>
            <input name="title" type="text" required className={inputClass} placeholder="Was ist zu tun?" />
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-600">Fällig am *</label>
            <input name="dueDate" type="date" required className={inputClass} />
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-600">Zuweisen an *</label>
            {users === null ? (
              <p className="text-sm text-gray-400">Mitarbeiter werden geladen …</p>
            ) : users.length === 0 ? (
              <p className="text-sm text-gray-400">Keine Mitarbeiter verfügbar.</p>
            ) : (
              <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-gray-200 p-2 sm:grid-cols-3 lg:grid-cols-4">
                {users.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" name="assignedTo" value={u.id} className="accent-brand-red" />
                    {u.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-600">Beschreibung (optional)</label>
            <textarea name="description" rows={3} className={inputClass} placeholder="Details …" />
          </div>

          <div className="mt-1 flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Wird gesendet …" : "Aufgabe senden"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              Abbrechen
            </button>
            {state.error && <span className="text-sm text-rose-600">{state.error}</span>}
            {state.success && <span className="text-sm text-emerald-600">✓ {state.success}</span>}
          </div>
        </form>
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
        ➕ Aufgabe
      </button>
      {mounted && modal && createPortal(modal, document.body)}
    </>
  );
}
