"use client";

import { createContext, useActionState, useContext, useState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createTaskAction,
  setStatusAction,
  forwardAction,
  addNoteAction,
  taskButtonAction,
  loadPersonTasksAction,
  sendReviewEmailAction,
  type CreateTaskState,
} from "@/app/dashboard/aufgaben/actions";

/** Google-Bewertungslink (aus den Einstellungen) für den „E-Mail öffnen"-Button. */
const ReviewUrlContext = createContext<string>("");
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
  projectMatchId: number | null;
  /** Alle dem Beleg zugeordneten Projekte (aus den Belegpositionen). */
  projects: { relativeId: number | null; name: string }[];
  history: { actionLabel: string; detail: string | null; byName: string | null; at: string | null }[];
}

/** Extracts the HERO receipt id from a review task's marker, or null. */
function reviewHeroId(description: string | null): string | null {
  const m = description?.match(/\[RECHNPRUEF:([^\]]+)\]/);
  return m ? m[1] : null;
}

/** Removes internal markers (e.g. [RECHNPRUEF:..], [EKREQ:..], [BEWERTUNG:..]) from display text. */
function cleanDescription(description: string | null): string {
  return (description ?? "").replace(/\s*\[[A-Z]+:[^\]]*\]/g, "").trim();
}

/** Extracts the customer email + name from a satisfaction-call task's [BEWERTUNG:email|name|projectKey] marker. */
function reviewEmailInfo(description: string | null): { email: string; name: string } | null {
  const m = description?.match(/\[BEWERTUNG:([^\]]*)\]/);
  if (!m) return null;
  // Marker-Format: email|kunde|projectKey – der Name ist nur der zweite Teil
  // (der projectKey darf nicht in die Mail-Anrede geraten).
  const parts = m[1].split("|");
  return { email: (parts[0] ?? "").trim(), name: (parts[1] ?? "").trim() };
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

/** Farbe des aktiven Segments im Status-Schalter. */
function statusActiveClass(status: TaskStatus): string {
  return status === "erledigt"
    ? "bg-emerald-600 text-white"
    : status === "in_arbeit"
      ? "bg-amber-500 text-white"
      : "bg-gray-700 text-white";
}

function TaskCard({
  task,
  users,
  review,
}: {
  task: Task;
  users: UserOption[];
  review?: ReviewTaskInfo | null;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [fwdOpen, setFwdOpen] = useState(false);
  const [localStatus, setLocalStatus] = useState<TaskStatus | null>(null);
  const [changing, setChanging] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [deciding, setDeciding] = useState(false);
  const router = useRouter();
  // Optimistischer Status: sofort sichtbar, bevor der Server nachzieht.
  const effectiveStatus: TaskStatus = localStatus ?? task.status;

  const changeStatus = async (status: TaskStatus) => {
    if (status === effectiveStatus || changing) return;
    setChanging(true);
    setLocalStatus(status); // sofort umschalten
    try {
      const fd = new FormData();
      fd.set("id", String(task.id));
      fd.set("status", status);
      await setStatusAction(fd);
      router.refresh();
    } catch {
      setLocalStatus(null); // bei Fehler zurück
    } finally {
      setChanging(false);
    }
  };

  const [busy, setBusy] = useState(false);

  const submitNote = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("id", String(task.id));
    if (!String(fd.get("note") ?? "").trim()) return;
    setBusy(true);
    try {
      await addNoteAction(fd);
      form.reset();
      setNoteOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const submitForward = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("id", String(task.id));
    if (!fd.get("toUserId")) return;
    setBusy(true);
    try {
      await forwardAction(fd);
      setFwdOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const clickActionButton = async (label: string) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("id", String(task.id));
      fd.set("label", label);
      await taskButtonAction(fd);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const assigneeNames = task.assignees.map((a) => a.name).join(", ") || "—";
  const overdue = isOverdue(task.dueDate, effectiveStatus);
  const heroId = reviewHeroId(task.description);
  const desc = cleanDescription(task.description);
  const bewertung = reviewEmailInfo(task.description);
  const [bewMail, setBewMail] = useState(bewertung?.email ?? "");
  const googleReviewUrl = useContext(ReviewUrlContext);
  const [bewSending, setBewSending] = useState(false);
  const [bewSent, setBewSent] = useState(false);
  const [bewMsg, setBewMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const sendReviewMail = async () => {
    if (!bewMail.trim()) return;
    setBewSending(true);
    setBewMsg(null);
    try {
      const fd = new FormData();
      fd.set("taskId", String(task.id));
      fd.set("email", bewMail.trim());
      fd.set("name", bewertung?.name ?? "");
      const res = await sendReviewEmailAction(fd);
      if (res.ok) {
        setBewSent(true);
        setBewMsg({ ok: true, text: "Bewertungsmail gesendet." });
      } else if (res.alreadySent) {
        setBewSent(true);
        setBewMsg({ ok: false, text: res.error ?? "Bereits versendet." });
      } else {
        setBewMsg({ ok: false, text: res.error ?? "Fehler beim Senden." });
      }
    } finally {
      setBewSending(false);
    }
  };

  const decideReview = async (decision: "freigegeben" | "abgelehnt") => {
    if (!heroId) return;
    setDeciding(true);
    try {
      const fd = new FormData();
      fd.set("heroId", heroId);
      fd.set("number", review?.number ?? "");
      fd.set("supplier", review?.supplier ?? "");
      fd.set("gross", String(review?.gross ?? ""));
      fd.set("decision", decision);
      if (reviewNote.trim()) fd.set("note", reviewNote.trim());
      const res = await decideReviewAction(fd);
      // Nach Freigabe: Projekt-Popup öffnen (Beleg-Artikel den Soll-Artikeln zuordnen).
      if (res?.openProjectId) router.push(`/dashboard/projekte?open=${res.openProjectId}&from=aufgaben`);
      else router.refresh();
    } finally {
      setDeciding(false);
    }
  };

  const accentLeft = overdue
    ? "border-l-rose-500"
    : effectiveStatus === "erledigt"
      ? "border-l-emerald-500"
      : effectiveStatus === "in_arbeit"
        ? "border-l-amber-500"
        : "border-l-gray-400";
  return (
    <div
      className={`rounded-lg border border-l-4 p-4 ${
        effectiveStatus === "erledigt"
          ? "border-gray-200 bg-gray-50"
          : overdue
            ? "border-rose-200 bg-rose-50/40"
            : "border-gray-300 bg-white"
      } ${accentLeft}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p
          className={`min-w-0 font-medium ${
            effectiveStatus === "erledigt" ? "text-gray-500 line-through" : "text-gray-900"
          }`}
        >
          {task.title}
        </p>
        <StatusBadge status={effectiveStatus} />
      </div>
      {desc && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{desc}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden>👤</span>
          {task.createdByName} → {assigneeNames}
        </span>
        {task.dueDate && (
          <span className={overdue ? "font-semibold text-rose-600" : ""}>
            📅 {formatDate(task.dueDate)}
            {overdue ? " · überfällig" : ""}
          </span>
        )}
        {task.projectName && (
          <span>
            📁 {task.projectRelativeId != null ? `#${task.projectRelativeId} ` : ""}
            {task.projectName}
          </span>
        )}
      </div>

      {/* Vordefinierte Antwort-Buttons (z.B. aus einer Workflow-Regel) */}
      {task.actionButtons.length > 0 && effectiveStatus !== "erledigt" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-brand-red/20 bg-brand-red/5 p-2">
          <span className="text-xs font-medium text-gray-600">Antwort:</span>
          {task.actionButtons.map((label) => (
            <button
              key={label}
              type="button"
              disabled={busy}
              onClick={() => clickActionButton(label)}
              title="Antwort senden & Aufgabe erledigen"
              className="rounded-md border border-brand-red/40 bg-white px-3 py-1 text-xs font-semibold text-brand-red transition-colors hover:bg-brand-red hover:text-white disabled:opacity-50"
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Endrechnung: Google-Bewertungslink an Kunde senden (E-Mail aus Kundenstamm) */}
      {bewertung && (
        <div className="mt-3 rounded-lg border border-amber-300/50 bg-amber-50 p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            Google-Bewertung an Kunde senden
          </span>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="email"
              value={bewMail}
              onChange={(e) => setBewMail(e.target.value)}
              placeholder="E-Mail des Kunden"
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-red/60"
            />
            <button
              type="button"
              disabled={bewSending || bewSent || !bewMail.trim()}
              onClick={sendReviewMail}
              className="shrink-0 rounded-md bg-brand-red px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {bewSent ? "✓ Versendet" : bewSending ? "Sendet …" : "📧 Bewertungsmail senden"}
            </button>
          </div>
          {!bewertung.email && (
            <p className="mt-1 text-xs text-amber-700">Keine E-Mail im Kundenstamm – bitte eintragen.</p>
          )}
          {!googleReviewUrl && (
            <p className="mt-1 text-xs text-amber-700">
              Kein Bewertungslink hinterlegt – unter Konfiguration → Einstellungen eintragen.
            </p>
          )}
          {bewMsg ? (
            <p className={`mt-1 text-xs ${bewMsg.ok ? "text-emerald-600" : "text-brand-red"}`}>{bewMsg.text}</p>
          ) : (
            <p className="mt-1 text-xs text-gray-500">HTML-Mail mit Bewertungs-Button (über SMTP) – nur einmal pro Kunde/Projekt möglich.</p>
          )}
        </div>
      )}

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
                title="Beleg-PDF in neuem Tab öffnen"
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-red px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
              >
                📄 Beleg öffnen (PDF)
              </a>
            ) : (
              <span className="text-xs text-gray-400">Kein PDF hinterlegt</span>
            )}
          </div>

          {review?.projects && review.projects.length > 0 && (
            <p className="mt-2 text-xs text-gray-600">
              <span className="font-medium text-gray-500">
                Zugeordnete{review.projects.length > 1 ? " Projekte" : "s Projekt"}:{" "}
              </span>
              {review.projects.map((p, i) => (
                <span key={i}>
                  {i > 0 ? " · " : ""}
                  {p.relativeId != null ? `#${p.relativeId} ` : ""}
                  {p.name}
                </span>
              ))}
            </p>
          )}

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
            <div className="mt-2 flex flex-col gap-2">
              <textarea
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                rows={2}
                placeholder="Kommentar (optional) …"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={deciding}
                  onClick={() => decideReview("freigegeben")}
                  title={review?.projectMatchId ? "Freigeben und Projekt zum Artikel-Abgleich öffnen" : "Freigeben"}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {deciding ? "…" : "Freigeben"}
                </button>
                <button
                  type="button"
                  disabled={deciding}
                  onClick={() => decideReview("abgelehnt")}
                  className="rounded-md bg-brand-red px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  Ablehnen
                </button>
                {review?.projectMatchId && (
                  <span className="text-xs text-gray-400">→ öffnet Projekt zum Artikel-Abgleich</span>
                )}
              </div>
            </div>
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
        {/* Status-Schalter – Klick ändert den Status sofort */}
        <div className="inline-flex overflow-hidden rounded-md border border-gray-300">
          {STATUS_ACTIONS.map((s, i) => {
            const cur = s.key === effectiveStatus;
            const base = `px-2.5 py-1 text-xs font-medium ${i > 0 ? "border-l border-gray-300" : ""}`;
            if (cur) {
              return (
                <span key={s.key} className={`${base} ${statusActiveClass(effectiveStatus)}`}>
                  ✓ {s.label}
                </span>
              );
            }
            return (
              <button
                key={s.key}
                type="button"
                disabled={changing}
                onClick={() => changeStatus(s.key)}
                title={`Status auf „${s.label}" setzen`}
                className={`${base} bg-white text-gray-600 hover:bg-gray-100 disabled:opacity-50`}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setFwdOpen((o) => !o)}
            title="Weiterleiten"
            className="flex h-7 items-center gap-1 rounded-md border border-gray-300 px-2 text-xs font-medium text-gray-600 transition-colors hover:border-brand-red/50 hover:text-gray-900"
          >
            ↗ Weiterleiten
          </button>
          <button
            type="button"
            onClick={() => setNoteOpen((o) => !o)}
            title="Notiz / Rückmeldung"
            className="flex h-7 items-center gap-1 rounded-md border border-gray-300 px-2 text-xs font-medium text-gray-600 transition-colors hover:border-brand-red/50 hover:text-gray-900"
          >
            💬 Notiz
          </button>
        </div>
      </div>

      {fwdOpen && (
        <form onSubmit={submitForward} className="mt-2 flex items-center gap-2">
          <input type="hidden" name="id" value={task.id} />
          <select
            name="toUserId"
            defaultValue=""
            required
            className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-800 outline-none focus:border-brand-red/60"
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
            disabled={busy}
            className="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900 disabled:opacity-50"
          >
            {busy ? "…" : "Weiterleiten"}
          </button>
        </form>
      )}

      {noteOpen && (
        <form onSubmit={submitNote} className="mt-2 flex items-end gap-2">
          <input type="hidden" name="id" value={task.id} />
          <textarea
            name="note"
            rows={2}
            required
            placeholder="Notiz / Rückmeldung … (geht an den Ersteller)"
            className="min-h-[2.5rem] flex-1 resize-y rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60"
          />
          <button
            type="submit"
            disabled={busy}
            className="shrink-0 rounded-md bg-brand-red px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Sendet …" : "Senden"}
          </button>
        </form>
      )}

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
  googleReviewUrl = "",
}: {
  assigned: Task[];
  created: Task[];
  allOpen: Task[];
  isAdmin: boolean;
  users: UserOption[];
  projects: ProjectOption[];
  meId: number;
  reviewsByHeroId?: Record<string, ReviewTaskInfo>;
  googleReviewUrl?: string;
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
  // Admin: Aufgaben einer bestimmten Person anzeigen.
  const [personId, setPersonId] = useState<number>(0);
  const [personTasks, setPersonTasks] = useState<Task[] | null>(null);
  const [loadingPerson, startLoadPerson] = useTransition();
  const selectPerson = (id: number) => {
    setPersonId(id);
    if (id > 0) {
      startLoadPerson(async () => {
        setPersonTasks(await loadPersonTasksAction(id));
      });
    } else {
      setPersonTasks(null);
    }
  };
  const personName = users.find((u) => u.id === personId)?.name ?? "";
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
    <ReviewUrlContext.Provider value={googleReviewUrl}>
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
        {isAdmin && (
          <select
            value={personId}
            onChange={(e) => selectPerson(Number(e.target.value))}
            title="Alle Aufgaben einer Person anzeigen"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-800 outline-none focus:border-brand-red/60"
          >
            <option value={0}>Person: alle</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Suchen (Titel, Mitarbeiter, Projekt …)"
          className="ml-auto w-full max-w-xs rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-red/60"
        />
      </div>

      {/* Admin: Aufgaben einer bestimmten Person */}
      {isAdmin && personId > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-gray-900">
            Aufgaben von {personName}{" "}
            <span className="text-sm font-normal text-gray-500">
              ({(personTasks ?? []).filter(matchesFilter).length})
            </span>
          </h2>
          {loadingPerson ? (
            <p className="text-sm text-gray-400">Wird geladen …</p>
          ) : (personTasks ?? []).filter(matchesFilter).length === 0 ? (
            <p className="text-sm text-gray-400">Keine Aufgaben für diesen Filter.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {(personTasks ?? []).filter(matchesFilter).map((t) => (
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

      {/* Admin: alle offenen Aufgaben */}
      {isAdmin && personId === 0 && (
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

      {/* Eigene Listen ausblenden, wenn eine Person gefiltert ist (nur deren Aufgaben zeigen). */}
      {personId === 0 && (
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
      )}
    </div>
    </ReviewUrlContext.Provider>
  );
}
