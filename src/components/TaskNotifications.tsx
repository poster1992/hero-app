"use client";

import {
  acknowledgeNotificationAction,
  acknowledgeAllNotificationsAction,
} from "@/app/dashboard/aufgaben/actions";
import type { TaskNotification } from "@/lib/task-notifications";

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

export default function TaskNotifications({ items }: { items: TaskNotification[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-amber-800">
          🔔 Neue Meldungen ({items.length})
        </h2>
        <form action={acknowledgeAllNotificationsAction}>
          <button
            type="submit"
            className="rounded-md border border-amber-400 px-2.5 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
          >
            Alle bestätigen
          </button>
        </form>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((n) => (
          <li
            key={n.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2"
          >
            <span className="shrink-0" aria-hidden>
              {n.kind === "assigned" ? "📋" : "💬"}
            </span>
            <span className="min-w-0 flex-1 text-sm text-gray-800">
              {n.message}
              <span className="ml-2 text-xs text-gray-400">
                {n.byName ? `von ${n.byName} · ` : ""}
                {formatDateTime(n.createdAt)}
              </span>
            </span>
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
    </div>
  );
}
