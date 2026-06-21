"use client";

import { useActionState, useState } from "react";
import {
  createTaskAction,
  setStatusAction,
  forwardAction,
  type CreateTaskState,
} from "@/app/dashboard/aufgaben/actions";
import { taskStatusLabel, isOverdue, type Task, type TaskStatus } from "@/lib/task-types";

interface UserOption {
  id: number;
  name: string;
}

interface ProjectOption {
  id: number;
  relativeId: number | null;
  name: string;
}

function formatDate(d: string | null): string {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}

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

function StatusBadge({ status }: { status: TaskStatus }) {
  const cls =
    status === "erledigt"
      ? "bg-emerald-100 text-emerald-700"
      : status === "in_arbeit"
        ? "bg-amber-100 text-amber-700"
        : "bg-gray-200 text-gray-600";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {taskStatusLabel(status)}
    </span>
  );
}

const STATUS_ACTIONS: { key: TaskStatus; label: string }[] = [
  { key: "offen", label: "Offen" },
  { key: "in_arbeit", label: "In Arbeit" },
  { key: "erledigt", label: "Erledigt" },
];

function TaskCard({ task, users }: { task: Task; users: UserOption[] }) {
  const assigneeNames = task.assignees.map((a) => a.name).join(", ") || "—";
  const overdue = isOverdue(task.dueDate, task.status);
  return (
    <div
      className={`rounded-lg border p-4 ${
        task.status === "erledigt"
          ? "border-gray-200 bg-gray-50 opacity-75"
          : overdue
            ? "border-rose-400 bg-rose-50"
            : "border-gray-300 bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-gray-900">{task.title}</p>
          {task.description && (
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{task.description}</p>
          )}
          <p className="mt-2 text-xs text-gray-500">
            von {task.createdByName} · an {assigneeNames}
            {task.dueDate && (
              <span className={overdue ? "font-semibold text-rose-600" : ""}>
                {" · "}fällig {formatDate(task.dueDate)}
                {overdue ? " (überfällig)" : ""}
              </span>
            )}
          </p>
          {task.projectName && (
            <p className="mt-0.5 text-xs text-gray-500">
              Projekt: {task.projectRelativeId != null ? `#${task.projectRelativeId} ` : ""}
              {task.projectName}
            </p>
          )}
        </div>
        <StatusBadge status={task.status} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {STATUS_ACTIONS.filter((s) => s.key !== task.status).map((s) => (
          <form key={s.key} action={setStatusAction}>
            <input type="hidden" name="id" value={task.id} />
            <input type="hidden" name="status" value={s.key} />
            <button
              type="submit"
              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
            >
              → {s.label}
            </button>
          </form>
        ))}

        {/* Weiterleiten */}
        <form action={forwardAction} className="ml-auto flex items-center gap-1">
          <input type="hidden" name="id" value={task.id} />
          <select
            name="toUserId"
            defaultValue=""
            required
            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-800 outline-none focus:border-brand-red/60"
          >
            <option value="" disabled>
              weiterleiten an …
            </option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
          >
            ➜
          </button>
        </form>
      </div>

      {task.history.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700">
            Historie ({task.history.length})
          </summary>
          <ul className="mt-2 space-y-1 border-l-2 border-gray-200 pl-3">
            {task.history.map((h) => (
              <li key={h.id} className="text-xs text-gray-600">
                <span className="text-gray-400">{formatDateTime(h.at)}</span>
                {h.byName ? ` · ${h.byName}` : ""} — {h.detail}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function TaskManager({
  assigned,
  created,
  allOpen,
  isAdmin,
  users,
  projects,
}: {
  assigned: Task[];
  created: Task[];
  allOpen: Task[];
  isAdmin: boolean;
  users: UserOption[];
  projects: ProjectOption[];
  meId: number;
}) {
  const [state, formAction, pending] = useActionState<CreateTaskState, FormData>(
    createTaskAction,
    {}
  );
  const [projectQuery, setProjectQuery] = useState("");
  const [selectedProject, setSelectedProject] = useState<ProjectOption | null>(null);
  const projectMatches = (() => {
    const q = projectQuery.trim().toLowerCase();
    if (!q || selectedProject) return [];
    return projects
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.relativeId != null && String(p.relativeId).includes(q))
      )
      .slice(0, 8);
  })();

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60";

  return (
    <div className="flex flex-col gap-6">
      {/* Neue Aufgabe */}
      <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Aufgabe senden</h2>
        <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm text-gray-600">Titel *</label>
            <input name="title" type="text" required className={inputClass} placeholder="Was ist zu tun?" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm text-gray-600">Beschreibung</label>
            <textarea name="description" rows={3} className={inputClass} placeholder="Details …" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm text-gray-600">
              An Mitarbeiter * <span className="text-gray-400">(Mehrfachauswahl möglich)</span>
            </label>
            <div className="grid max-h-44 grid-cols-1 gap-1 overflow-y-auto rounded-md border border-gray-300 p-2 sm:grid-cols-2">
              {users.length === 0 ? (
                <span className="text-sm text-gray-400">Keine Mitarbeiter vorhanden.</span>
              ) : (
                users.map((u) => (
                  <label
                    key={u.id}
                    className="flex items-center gap-2 rounded px-2 py-1 text-sm text-gray-800 hover:bg-gray-50"
                  >
                    <input type="checkbox" name="assignedTo" value={u.id} className="accent-brand-red" />
                    {u.name}
                  </label>
                ))
              )}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Fällig bis *</label>
            <input name="dueDate" type="date" required className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm text-gray-600">
              Projekt <span className="text-gray-400">(optional)</span>
            </label>
            {/* Hidden inputs tragen die Auswahl ins Formular */}
            <input type="hidden" name="projectId" value={selectedProject?.id ?? ""} />
            <input type="hidden" name="projectRelativeId" value={selectedProject?.relativeId ?? ""} />
            <input type="hidden" name="projectName" value={selectedProject?.name ?? ""} />

            {selectedProject ? (
              <div className="flex items-center justify-between rounded-md border border-gray-300 px-3 py-2 text-sm">
                <span className="text-gray-900">
                  {selectedProject.relativeId != null ? `#${selectedProject.relativeId} ` : ""}
                  {selectedProject.name}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedProject(null);
                    setProjectQuery("");
                  }}
                  className="text-xs text-gray-400 hover:text-gray-700"
                >
                  ✕ ändern
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={projectQuery}
                  onChange={(e) => setProjectQuery(e.target.value)}
                  placeholder="Projekt suchen (Name oder Nummer) …"
                  className={inputClass}
                />
                {projectMatches.length > 0 && (
                  <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                    {projectMatches.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedProject(p);
                            setProjectQuery("");
                          }}
                          className="block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-100"
                        >
                          {p.relativeId != null && <span className="text-gray-500">#{p.relativeId} </span>}
                          {p.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="sm:col-span-2 flex items-center gap-4">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Wird gesendet …" : "Aufgabe senden"}
            </button>
            {state.error && <span className="text-sm text-rose-600">{state.error}</span>}
            {state.success && <span className="text-sm text-emerald-700">{state.success}</span>}
          </div>
        </form>
      </div>

      {/* Admin: alle offenen Aufgaben */}
      {isAdmin && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-gray-900">
            Alle offenen Aufgaben{" "}
            <span className="text-sm font-normal text-gray-500">({allOpen.length})</span>
          </h2>
          {allOpen.length === 0 ? (
            <p className="text-sm text-gray-400">Keine offenen Aufgaben.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {allOpen.map((t) => (
                <TaskCard key={t.id} task={t} users={users} />
              ))}
            </div>
          )}
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Mir zugewiesen */}
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-gray-900">
            Mir zugewiesen{" "}
            <span className="text-sm font-normal text-gray-500">({assigned.length})</span>
          </h2>
          {assigned.length === 0 ? (
            <p className="text-sm text-gray-400">Keine Aufgaben.</p>
          ) : (
            assigned.map((t) => <TaskCard key={t.id} task={t} users={users} />)
          )}
        </section>

        {/* Von mir gesendet */}
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-gray-900">
            Von mir gesendet{" "}
            <span className="text-sm font-normal text-gray-500">({created.length})</span>
          </h2>
          {created.length === 0 ? (
            <p className="text-sm text-gray-400">Keine Aufgaben.</p>
          ) : (
            created.map((t) => <TaskCard key={t.id} task={t} users={users} />)
          )}
        </section>
      </div>
    </div>
  );
}
