"use client";

import { useActionState, useState, useEffect, useRef } from "react";
import {
  createTaskAction,
  setStatusAction,
  forwardAction,
  addNoteAction,
  type CreateTaskState,
} from "@/app/dashboard/aufgaben/actions";
import { decideReviewAction } from "@/app/dashboard/belege/review-actions";
import { taskStatusLabel, isOverdue, type Task, type TaskStatus } from "@/lib/task-types";

export interface ReviewTaskInfo {
  status: "offen" | "freigegeben" | "abgelehnt";
  docUrl: string | null;
  number: string | null;
  supplier: string | null;
  gross: number | null;
  reviewedByName: string | null;
  note: string | null;
  history: { actionLabel: string; detail: string | null; byName: string | null; at: string | null }[];
}

/** Extracts the HERO receipt id from a review task's marker, or null. */
function reviewHeroId(description: string | null): string | null {
  const m = description?.match(/\[RECHNPRUEF:([^\]]+)\]/);
  return m ? m[1] : null;
}

/** Removes internal markers (e.g. [RECHNPRUEF:..], [EKREQ:..]) from display text. */
function cleanDescription(description: string | null): string {
  return (description ?? "").replace(/\s*\[[A-Z]+:[^\]]+\]/g, "").trim();
}

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

function TaskCard({
  task,
  users,
  review,
}: {
  task: Task;
  users: UserOption[];
  review?: ReviewTaskInfo | null;
}) {
  const assigneeNames = task.assignees.map((a) => a.name).join(", ") || "—";
  const overdue = isOverdue(task.dueDate, task.status);
  const heroId = reviewHeroId(task.description);
  const desc = cleanDescription(task.description);
  return (
    <div
      className={`rounded-lg border p-4 ${
        task.status === "erledigt"
          ? "border-gray-200 bg-gray-50 opacity-75"
          : overdue
            ? "border-rose-500/40 bg-rose-500/10"
            : "border-gray-300 bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-gray-900">{task.title}</p>
          {desc && (
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{desc}</p>
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

      {/* Rechnungsprüfung: PDF + Entscheidung direkt in der Aufgabe */}
      {heroId && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Rechnungsprüfung
            </span>
            {review?.docUrl ? (
              <a
                href={review.docUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-brand-red hover:underline"
              >
                Beleg (PDF) ansehen
              </a>
            ) : (
              <span className="text-xs text-gray-400">Kein PDF hinterlegt</span>
            )}
          </div>

          {review?.status === "freigegeben" || review?.status === "abgelehnt" ? (
            <p
              className={`mt-2 text-sm font-medium ${
                review.status === "freigegeben" ? "text-emerald-600" : "text-brand-red"
              }`}
            >
              {review.status === "freigegeben" ? "Freigegeben" : "Abgelehnt"}
              {review.reviewedByName ? ` von ${review.reviewedByName}` : ""}
              {review.note ? ` · ${review.note}` : ""}
            </p>
          ) : (
            <form action={decideReviewAction} className="mt-2 flex flex-col gap-2">
              <input type="hidden" name="heroId" value={heroId} />
              <input type="hidden" name="number" value={review?.number ?? ""} />
              <input type="hidden" name="supplier" value={review?.supplier ?? ""} />
              <input type="hidden" name="gross" value={review?.gross ?? ""} />
              <textarea
                name="note"
                rows={2}
                placeholder="Kommentar (optional) …"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60"
              />
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  name="decision"
                  value="freigegeben"
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                >
                  Freigeben
                </button>
                <button
                  type="submit"
                  name="decision"
                  value="abgelehnt"
                  className="rounded-md bg-brand-red px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                >
                  Ablehnen
                </button>
              </div>
            </form>
          )}

          {review?.history && review.history.length > 0 && (
            <ul className="mt-3 space-y-1 border-l-2 border-gray-200 pl-3">
              {review.history.map((h, i) => (
                <li key={i} className="text-xs text-gray-600">
                  <span className="text-gray-400">{formatDateTime(h.at)}</span>
                  {h.byName ? ` · ${h.byName}` : ""} —{" "}
                  <span className="font-medium">{h.actionLabel}</span>
                  {h.detail ? `: ${h.detail}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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

      {/* Notiz / Rückmeldung hinzufügen (geht als Meldung an den Ersteller) */}
      <form action={addNoteAction} className="mt-3 flex items-end gap-2">
        <input type="hidden" name="id" value={task.id} />
        <textarea
          name="note"
          rows={1}
          required
          placeholder="Notiz / Rückmeldung … (geht an den Ersteller)"
          className="min-h-[2.25rem] flex-1 resize-y rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60"
        />
        <button
          type="submit"
          className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
        >
          💬 Notiz
        </button>
      </form>

      {task.history.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700">
            Verlauf &amp; Notizen ({task.history.length})
          </summary>
          <ul className="mt-2 space-y-1 border-l-2 border-gray-200 pl-3">
            {task.history.map((h) => (
              <li
                key={h.id}
                className={`text-xs ${h.action === "note" ? "text-gray-800" : "text-gray-600"}`}
              >
                <span className="text-gray-400">{formatDateTime(h.at)}</span>
                {h.byName ? ` · ${h.byName}` : ""} — {h.action === "note" ? <>💬 {h.detail}</> : h.detail}
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
  reviewsByHeroId = {},
}: {
  assigned: Task[];
  created: Task[];
  allOpen: Task[];
  isAdmin: boolean;
  users: UserOption[];
  projects: ProjectOption[];
  meId: number;
  reviewsByHeroId?: Record<string, ReviewTaskInfo>;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<CreateTaskState, FormData>(
    createTaskAction,
    {}
  );
  const [projectQuery, setProjectQuery] = useState("");
  const [selectedProject, setSelectedProject] = useState<ProjectOption | null>(null);

  // Nach erfolgreichem Anlegen Pop-up schließen und Auswahl zurücksetzen.
  const lastSuccess = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!state.success || state.success === lastSuccess.current) return;
    lastSuccess.current = state.success;
    const t = setTimeout(() => {
      setOpen(false);
      setSelectedProject(null);
      setProjectQuery("");
    }, 0);
    return () => clearTimeout(t);
  }, [state.success]);
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

  // Filter (Status + Suche) für die Aufgabenlisten.
  const [statusFilter, setStatusFilter] = useState<
    "alle" | "offen" | "in_arbeit" | "erledigt" | "ueberfaellig"
  >("alle");
  const [search, setSearch] = useState("");
  const matchesFilter = (t: Task) => {
    if (statusFilter === "ueberfaellig") {
      if (!isOverdue(t.dueDate, t.status)) return false;
    } else if (statusFilter !== "alle" && t.status !== statusFilter) {
      return false;
    }
    const q = search.trim().toLowerCase();
    if (q) {
      const hay = `${t.title} ${t.description ?? ""} ${t.assignees
        .map((a) => a.name)
        .join(" ")} ${t.projectName ?? ""} ${t.createdByName}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };
  const fAssigned = assigned.filter(matchesFilter);
  const fCreated = created.filter(matchesFilter);
  const fAllOpen = allOpen.filter(matchesFilter);

  const STATUS_FILTERS: { key: typeof statusFilter; label: string }[] = [
    { key: "alle", label: "Alle" },
    { key: "offen", label: "Offen" },
    { key: "in_arbeit", label: "In Arbeit" },
    { key: "erledigt", label: "Erledigt" },
    { key: "ueberfaellig", label: "Überfällig" },
  ];

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60";

  return (
    <div className="flex flex-col gap-6">
      {/* Neue Aufgabe – Button öffnet Pop-up */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          + Neue Aufgabe
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-xl border border-gray-300 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Neue Aufgabe</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-gray-400 transition-colors hover:text-gray-700"
                aria-label="Schließen"
              >
                ✕
              </button>
            </div>
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
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              Abbrechen
            </button>
            {state.error && <span className="text-sm text-rose-600">{state.error}</span>}
          </div>
            </form>
          </div>
        </div>
      )}

      {/* Filterleiste */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => {
            const active = statusFilter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setStatusFilter(f.key)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-brand-red text-white"
                    : "border border-gray-300 text-gray-600 hover:border-brand-red/50 hover:text-gray-900"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Suchen (Titel, Mitarbeiter, Projekt …)"
          className="ml-auto w-full max-w-xs rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-red/60"
        />
      </div>

      {/* Admin: alle offenen Aufgaben */}
      {isAdmin && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-gray-900">
            Alle offenen Aufgaben{" "}
            <span className="text-sm font-normal text-gray-500">({fAllOpen.length})</span>
          </h2>
          {fAllOpen.length === 0 ? (
            <p className="text-sm text-gray-400">Keine Aufgaben für diesen Filter.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {fAllOpen.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  users={users}
                  review={reviewsByHeroId[reviewHeroId(t.description) ?? ""]}
                />
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
            <span className="text-sm font-normal text-gray-500">({fAssigned.length})</span>
          </h2>
          {fAssigned.length === 0 ? (
            <p className="text-sm text-gray-400">Keine Aufgaben für diesen Filter.</p>
          ) : (
            fAssigned.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                users={users}
                review={reviewsByHeroId[reviewHeroId(t.description) ?? ""]}
              />
            ))
          )}
        </section>

        {/* Von mir gesendet */}
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-gray-900">
            Von mir gesendet{" "}
            <span className="text-sm font-normal text-gray-500">({fCreated.length})</span>
          </h2>
          {fCreated.length === 0 ? (
            <p className="text-sm text-gray-400">Keine Aufgaben für diesen Filter.</p>
          ) : (
            fCreated.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                users={users}
                review={reviewsByHeroId[reviewHeroId(t.description) ?? ""]}
              />
            ))
          )}
        </section>
      </div>
    </div>
  );
}
