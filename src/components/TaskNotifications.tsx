"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  acknowledgeNotificationAction,
  acknowledgeAllNotificationsAction,
  getTaskDetailAction,
} from "@/app/dashboard/aufgaben/actions";
import type { TaskNotification } from "@/lib/task-notifications";
import { taskStatusLabel, type Task } from "@/lib/task-types";

function formatDateTime(s: string | null): string {
  if (!s) return "";
  const d = new Date(s.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(s: string | null): string {
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return d ? `${d}.${m}.${y}` : s;
}

const HISTORY_ICON: Record<string, string> = {
  note: "💬",
  status: "🔁",
  created: "✨",
  forwarded: "↗",
};

/** Detail-Popup zu einer Meldung: zeigt die vollständige Aufgabe inkl. Projekt & Verlauf. */
function TaskDetailModal({ task, onClose }: { task: Task; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const assignees = task.assignees.map((a) => a.name).join(", ") || "—";
  const projectLabel = task.projectName
    ? `${task.projectRelativeId != null ? `#${task.projectRelativeId} ` : ""}${task.projectName}`
    : null;

  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="my-8 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-gray-300 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-gray-900">{task.title}</h2>
            <span
              className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                task.status === "erledigt"
                  ? "bg-emerald-100 text-emerald-700"
                  : task.status === "in_arbeit"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-gray-100 text-gray-600"
              }`}
            >
              {taskStatusLabel(task.status)}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="shrink-0 text-gray-400 transition-colors hover:text-gray-700"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {/* Eckdaten */}
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-gray-500">Projekt</dt>
            <dd className="text-gray-900">
              {projectLabel ? (
                task.projectId ? (
                  <Link
                    href={`/dashboard/projekte?open=${task.projectId}&back=/dashboard/aufgaben`}
                    className="font-medium text-brand-red hover:underline"
                    title="Projekt-Details öffnen"
                  >
                    📁 {projectLabel}
                  </Link>
                ) : (
                  <span>📁 {projectLabel}</span>
                )
              ) : (
                <span className="text-gray-400">— kein Projekt</span>
              )}
            </dd>

            <dt className="text-gray-500">Ersteller</dt>
            <dd className="text-gray-900">{task.createdByName}</dd>

            <dt className="text-gray-500">Zugewiesen</dt>
            <dd className="text-gray-900">{assignees}</dd>

            <dt className="text-gray-500">Fällig</dt>
            <dd className="text-gray-900">{formatDate(task.dueDate)}</dd>
          </dl>

          {/* Beschreibung */}
          {task.description && (
            <div className="mt-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Beschreibung</p>
              <p className="whitespace-pre-wrap rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
                {task.description}
              </p>
            </div>
          )}

          {/* Verlauf & Notizen */}
          <div className="mt-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Verlauf &amp; Notizen ({task.history.length})
            </p>
            {task.history.length === 0 ? (
              <p className="text-sm text-gray-400">Kein Verlauf.</p>
            ) : (
              <ul className="space-y-1.5 border-l-2 border-gray-200 pl-3">
                {task.history.map((h) => (
                  <li key={h.id} className="text-sm">
                    <span className="mr-1" aria-hidden>
                      {HISTORY_ICON[h.action] ?? "•"}
                    </span>
                    <span className={h.action === "note" ? "text-gray-800" : "text-gray-600"}>
                      {h.detail}
                    </span>
                    <span className="ml-1 text-xs text-gray-400">
                      {h.byName ? `· ${h.byName} ` : ""}· {formatDateTime(h.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex justify-end border-t border-gray-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function TaskNotifications({ items }: { items: TaskNotification[] }) {
  const [mounted, setMounted] = useState(false);
  const [detail, setDetail] = useState<Task | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [, startLoad] = useTransition();

  useEffect(() => setMounted(true), []);

  const openDetail = (taskId: number | null) => {
    if (!taskId) {
      setLoadError("Zu dieser Meldung gibt es keine Aufgabe mehr.");
      return;
    }
    setLoadError(null);
    setLoadingId(taskId);
    startLoad(async () => {
      const t = await getTaskDetailAction(taskId);
      setLoadingId(null);
      if (t) setDetail(t);
      else setLoadError("Aufgabe nicht gefunden (evtl. gelöscht).");
    });
  };

  if (items.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-amber-800">🔔 Neue Meldungen ({items.length})</h2>
        <form action={acknowledgeAllNotificationsAction}>
          <button
            type="submit"
            className="rounded-md border border-amber-400 px-2.5 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
          >
            Alle bestätigen
          </button>
        </form>
      </div>
      {loadError && <p className="mb-2 text-xs text-rose-600">{loadError}</p>}
      <ul className="flex flex-col gap-2">
        {items.map((n) => (
          <li
            key={n.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2"
          >
            <span className="shrink-0" aria-hidden>
              {n.kind === "assigned" ? "📋" : "💬"}
            </span>
            {/* Klickbarer Text → Aufgabe mit allen Infos (Projekt, Notizen, Verlauf) */}
            <button
              type="button"
              onClick={() => openDetail(n.taskId)}
              title="Aufgabe mit allen Infos öffnen"
              className="min-w-0 flex-1 rounded text-left text-sm text-gray-800 transition-colors hover:text-brand-red"
            >
              {n.message}
              <span className="ml-2 text-xs text-gray-400">
                {n.byName ? `von ${n.byName} · ` : ""}
                {formatDateTime(n.createdAt)}
                {loadingId === n.taskId ? " · lädt …" : ""}
              </span>
            </button>
            <form action={acknowledgeNotificationAction} className="shrink-0">
              <input type="hidden" name="id" value={n.id} />
              <button
                type="submit"
                className="rounded-md bg-brand-red px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
              >
                Zur Kenntnis genommen
              </button>
            </form>
          </li>
        ))}
      </ul>

      {mounted && detail && <TaskDetailModal task={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
