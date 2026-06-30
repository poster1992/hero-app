"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createWorkflowAction,
  updateWorkflowAction,
  toggleWorkflowAction,
  deleteWorkflowAction,
  runWorkflowsNowAction,
  type WorkflowFormState,
} from "@/app/dashboard/workflows/actions";
import type { Workflow, WorkflowConfig, WorkflowLogItem } from "@/lib/workflows";

interface UserOption {
  id: number;
  name: string;
}

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60";

const TRIGGER_OPTIONS = [
  { key: "new_beleg", label: "Neuer Beleg (Eingangsrechnung)" },
  { key: "angebot_alt_ohne_ab", label: "Angebot zu alt ohne AB (Pipeline 'Angebot offen')" },
] as const;

function triggerLabel(key: string): string {
  return TRIGGER_OPTIONS.find((t) => t.key === key)?.label ?? key;
}
function placeholdersFor(key: string): string {
  return key === "angebot_alt_ohne_ab"
    ? "{projekt} {nr} {kunde} {betrag} {tage} {angebotsdatum}"
    : "{nr} {lieferant} {betrag} {datum}";
}
function defaultTitleFor(key: string): string {
  return key === "angebot_alt_ohne_ab"
    ? "Angebot nachfassen: {projekt} ({tage} Tage alt)"
    : "Beleg prüfen: {nr} – {lieferant}";
}

function fmtStamp(s: string | null): string {
  if (!s) return "";
  const d = new Date(s.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Felder einer Regel (Auslöser → Aktion „Aufgabe erstellen"). */
function RuleFields({
  users,
  name,
  cfg,
  triggerKey = "new_beleg",
  editableTrigger = false,
}: {
  users: UserOption[];
  name?: string;
  cfg?: Partial<WorkflowConfig>;
  triggerKey?: string;
  editableTrigger?: boolean;
}) {
  const [trigger, setTrigger] = useState(triggerKey);
  const [title, setTitle] = useState(cfg?.title ?? defaultTitleFor(triggerKey));
  const [actionType, setActionType] = useState<"task" | "review">(cfg?.actionType === "review" ? "review" : "task");
  const isAngebot = trigger === "angebot_alt_ohne_ab";
  const isReview = trigger === "new_beleg" && actionType === "review";

  const onTriggerChange = (key: string) => {
    // Standardtitel mitwechseln, solange der Nutzer ihn nicht angepasst hat.
    if (title === defaultTitleFor(trigger)) setTitle(defaultTitleFor(key));
    if (key !== "new_beleg") setActionType("task"); // Rechnungsprüfung nur bei Belegen
    setTrigger(key);
  };

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="mb-1 block text-sm text-gray-600">Name der Regel *</label>
        <input name="name" defaultValue={name ?? ""} required placeholder="z.B. Angebote nachfassen" className={inputClass} />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-sm text-gray-600">Auslöser</label>
        {editableTrigger ? (
          <select name="triggerKey" value={trigger} onChange={(e) => onTriggerChange(e.target.value)} className={inputClass}>
            {TRIGGER_OPTIONS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input type="hidden" name="triggerKey" value={trigger} />
            <input value={triggerLabel(trigger)} disabled className={`${inputClass} opacity-60`} />
          </>
        )}
      </div>

      {/* Aktionstyp – Rechnungsprüfung nur beim Beleg-Auslöser */}
      <input type="hidden" name="actionType" value={isReview ? "review" : "task"} />
      {trigger === "new_beleg" && (
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm text-gray-600">Aktion</label>
          <select
            value={actionType}
            onChange={(e) => setActionType(e.target.value === "review" ? "review" : "task")}
            className={inputClass}
          >
            <option value="task">Aufgabe erstellen</option>
            <option value="review">Rechnungsprüfung (Beleg → Prüfung, PDF + Freigeben/Ablehnen)</option>
          </select>
        </div>
      )}

      {isAngebot && (
        <div>
          <label className="mb-1 block text-sm text-gray-600">Angebot älter als (Tage) *</label>
          <input name="minAgeDays" type="number" min={1} defaultValue={cfg?.minAgeDays ?? 21} className={inputClass} />
        </div>
      )}
      <div>
        <label className="mb-1 block text-sm text-gray-600">{isReview ? "Prüfer *" : "Aufgabe an *"}</label>
        <select name="assigneeId" defaultValue={cfg?.assigneeId ?? ""} required className={inputClass}>
          <option value="">Mitarbeiter wählen …</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>

      {isReview ? (
        <div className="sm:col-span-2 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-gray-300">
          Aktion „Rechnungsprüfung": Der Beleg wird auf <strong>„in Prüfung"</strong> gesetzt und der Prüfer
          erhält eine Aufgabe mit <strong>PDF + Freigeben/Ablehnen</strong>. Titel/Buttons/Fälligkeit entfallen
          (die Prüf-Aufgabe hat ihre eigenen Schaltflächen). Beschreibung wird als Notiz übernommen.
        </div>
      ) : (
        <>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm text-gray-600">
              Aufgaben-Titel <span className="text-gray-400">(Platzhalter: {placeholdersFor(trigger)})</span>
            </label>
            <input name="title" value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
          </div>
        </>
      )}
      <div className="sm:col-span-2">
        <label className="mb-1 block text-sm text-gray-600">Beschreibung (optional)</label>
        <textarea name="description" defaultValue={cfg?.description ?? ""} rows={2} className={inputClass} />
      </div>
      {!isReview && (
        <>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm text-gray-600">
              Antwort-Buttons <span className="text-gray-400">(Komma- oder zeilengetrennt, max. 8)</span>
            </label>
            <input
              name="buttons"
              defaultValue={(cfg?.buttons ?? []).join(", ")}
              placeholder="z.B. Erledigt, Nachfassen nötig, Kein Interesse"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-gray-400">
              Erscheinen an der Aufgabe; ein Klick protokolliert die Antwort, meldet sie dem Ersteller und
              erledigt die Aufgabe.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Fällig in (Tagen)</label>
            <input name="dueOffsetDays" type="number" min={0} defaultValue={cfg?.dueOffsetDays ?? 7} className={inputClass} />
          </div>
        </>
      )}
      <div>
        <label className="mb-1 block text-sm text-gray-600">Regel gilt ab (optional)</label>
        <input name="validFrom" type="date" defaultValue={cfg?.validFrom ?? ""} className={inputClass} />
        <p className="mt-1 text-xs text-gray-400">
          Nur Ereignisse ab diesem Datum ({isAngebot ? "Angebotsdatum" : "Belegdatum"}) lösen aus.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-sm text-gray-600">Filter: {isAngebot ? "Kunde" : "Lieferant"}</label>
          <input name="filterSupplier" defaultValue={cfg?.filterSupplier ?? ""} placeholder="enthält …" className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-600">Filter: ab {isAngebot ? "Angebotssumme" : "Betrag"} €</label>
          <input name="filterMinAmount" type="number" min={0} step="0.01" defaultValue={cfg?.filterMinAmount ?? ""} className={inputClass} />
        </div>
      </div>

      {/* Split nach Lieferant: ausgewaehlte Lieferanten gehen an einen anderen Bearbeiter */}
      <div className="sm:col-span-2 rounded-md border border-gray-200 p-3">
        <p className="mb-2 text-sm font-medium text-gray-700">
          Lieferanten-Split <span className="font-normal text-gray-400">(optional)</span>
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-gray-600">Ausgeschlossene Lieferanten</label>
            <input
              name="excludedSuppliers"
              defaultValue={(cfg?.excludedSuppliers ?? []).join(", ")}
              placeholder="z.B. Circle, Amazon (kommagetrennt)"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">… gehen stattdessen an</label>
            <select name="excludedAssigneeId" defaultValue={cfg?.excludedAssigneeId ?? ""} className={inputClass}>
              <option value="">— niemand (überspringen) —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          {isReview
            ? "Belege dieser Lieferanten gehen zur Prüfung an die hier gewählte Person, alle anderen an den Prüfer oben."
            : "Vorgänge dieser Lieferanten gehen an die hier gewählte Person, alle anderen an den Bearbeiter oben."}
        </p>
      </div>
    </div>
  );
}

function WorkflowRow({ wf, users }: { wf: Workflow; users: UserOption[] }) {
  const [editing, setEditing] = useState(false);
  const assignee = users.find((u) => u.id === wf.config.assigneeId)?.name ?? `#${wf.config.assigneeId}`;
  const excludedName = wf.config.excludedAssigneeId
    ? users.find((u) => u.id === wf.config.excludedAssigneeId)?.name ?? `#${wf.config.excludedAssigneeId}`
    : null;

  if (editing) {
    return (
      <li className="bg-gray-50 px-5 py-4">
        <form action={updateWorkflowAction} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={wf.id} />
          <RuleFields users={users} name={wf.name} cfg={wf.config} triggerKey={wf.triggerKey} />
          <div className="flex items-center gap-2">
            <button type="submit" className="rounded-md bg-brand-red px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90">
              Speichern
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Abbrechen
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${wf.active ? "bg-emerald-500" : "bg-gray-300"}`} title={wf.active ? "aktiv" : "inaktiv"} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-gray-900">{wf.name}</p>
        <p className="text-xs text-gray-500">
          {wf.triggerKey === "angebot_alt_ohne_ab"
            ? `Angebot offen > ${wf.config.minAgeDays ?? 21} Tage ohne AB`
            : "Neuer Beleg"}{" "}
          → {wf.config.actionType === "review" ? "Rechnungsprüfung" : "Aufgabe"} an{" "}
          <span className="text-gray-700">{assignee}</span>
          {wf.config.actionType === "review" ? "" : ` · fällig in ${wf.config.dueOffsetDays} Tagen`}
          {wf.config.filterSupplier
            ? ` · ${wf.triggerKey === "angebot_alt_ohne_ab" ? "Kunde" : "Lieferant"} „${wf.config.filterSupplier}"`
            : ""}
          {wf.config.filterMinAmount != null ? ` · ab ${wf.config.filterMinAmount} €` : ""}
          {wf.config.validFrom ? ` · gültig ab ${wf.config.validFrom.split("-").reverse().join(".")}` : ""}
          {wf.config.excludedSuppliers.length > 0 && excludedName
            ? ` · Split: „${wf.config.excludedSuppliers.join(", ")}" → ${excludedName}`
            : ""}
        </p>
      </div>
      <form action={toggleWorkflowAction}>
        <input type="hidden" name="id" value={wf.id} />
        <input type="hidden" name="active" value={wf.active ? "0" : "1"} />
        <button type="submit" className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-brand-red/50">
          {wf.active ? "Deaktivieren" : "Aktivieren"}
        </button>
      </form>
      <button type="button" onClick={() => setEditing(true)} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-brand-red/50">
        Bearbeiten
      </button>
      <form
        action={deleteWorkflowAction}
        onSubmit={(e) => {
          if (!window.confirm(`Regel „${wf.name}" löschen?`)) e.preventDefault();
        }}
      >
        <input type="hidden" name="id" value={wf.id} />
        <button type="submit" className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-brand-red/50 hover:text-brand-red">
          Löschen
        </button>
      </form>
    </li>
  );
}

/** Ein Knoten im Ablauf-Diagramm. */
function FlowNode({
  kind,
  title,
  lines,
}: {
  kind: "trigger" | "condition" | "action";
  title: string;
  lines: string[];
}) {
  const box =
    kind === "trigger"
      ? "border-sky-500/30 bg-sky-500/10"
      : kind === "condition"
        ? "border-amber-500/30 bg-amber-500/10"
        : "border-emerald-500/30 bg-emerald-500/10";
  const titleColor =
    kind === "trigger" ? "text-sky-300" : kind === "condition" ? "text-amber-300" : "text-emerald-300";
  const icon = kind === "trigger" ? "🧾" : kind === "condition" ? "⚙️" : "✅";
  return (
    <div className={`w-44 shrink-0 rounded-lg border px-3 py-2 ${box}`}>
      <div className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${titleColor}`}>
        <span aria-hidden>{icon}</span>
        {title}
      </div>
      {lines.map((l, i) => (
        <div key={i} className={i === 0 ? "mt-1 font-medium text-gray-100" : "text-xs text-gray-400"}>
          {l}
        </div>
      ))}
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="flex shrink-0 items-center self-center px-1 text-2xl leading-none text-gray-400" aria-hidden>
      →
    </div>
  );
}

/** Ablauf-Diagramm einer Regel: Auslöser → (Bedingung) → Aktion. */
function WorkflowFlow({ wf, users }: { wf: Workflow; users: UserOption[] }) {
  const assignee = users.find((u) => u.id === wf.config.assigneeId)?.name ?? `#${wf.config.assigneeId}`;
  const isAngebot = wf.triggerKey === "angebot_alt_ohne_ab";
  const triggerLines = isAngebot
    ? ["Angebot offen", `älter ${wf.config.minAgeDays ?? 21} Tage`, "kein AB"]
    : ["Neuer Beleg", "Eingangsrechnung"];
  const conditions: string[] = [];
  if (wf.config.filterSupplier)
    conditions.push(`${isAngebot ? "Kunde" : "Lieferant"} „${wf.config.filterSupplier}"`);
  if (wf.config.filterMinAmount != null) conditions.push(`ab ${wf.config.filterMinAmount} €`);
  return (
    <div className={`rounded-lg border px-4 py-3 ${wf.active ? "border-gray-200 bg-white" : "border-gray-200 bg-gray-50 opacity-70"}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${wf.active ? "bg-emerald-500" : "bg-gray-300"}`} />
        <span className="text-sm font-medium text-gray-900">{wf.name}</span>
        {!wf.active && <span className="text-xs text-gray-400">(inaktiv)</span>}
      </div>
      <div className="flex flex-wrap items-stretch gap-1 overflow-x-auto">
        <FlowNode kind="trigger" title="Auslöser" lines={triggerLines} />
        <FlowArrow />
        {conditions.length > 0 && (
          <>
            <FlowNode kind="condition" title="Bedingung" lines={conditions} />
            <FlowArrow />
          </>
        )}
        <FlowNode
          kind="action"
          title="Aktion"
          lines={
            wf.config.actionType === "review"
              ? ["Rechnungsprüfung", `Beleg → Prüfung`, `Prüfer ${assignee}`]
              : [`Aufgabe an ${assignee}`, `fällig in ${wf.config.dueOffsetDays} Tagen`]
          }
        />
      </div>
    </div>
  );
}

export default function WorkflowsManager({
  workflows,
  users,
  log,
}: {
  workflows: Workflow[];
  users: UserOption[];
  log: WorkflowLogItem[];
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"liste" | "diagramm">("liste");
  const [state, formAction, pending] = useActionState<WorkflowFormState, FormData>(createWorkflowAction, {});
  const router = useRouter();
  const [running, startRun] = useTransition();
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const runNow = () => {
    setRunMsg(null);
    startRun(async () => {
      const r = await runWorkflowsNowAction();
      if (!r.ok) setRunMsg(r.error ?? "Fehler.");
      else setRunMsg(`Geprüft: ${r.checked} · Aufgaben erstellt: ${r.created}`);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Neue Regel */}
      <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-medium text-gray-900">Regeln</h2>
          <div className="flex flex-wrap items-center gap-2">
            {runMsg && <span className="text-xs text-gray-500">{runMsg}</span>}
            <button
              type="button"
              onClick={runNow}
              disabled={running}
              title="Regeln sofort prüfen (umgeht die 5-Min-Drossel)"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 disabled:opacity-50"
            >
              {running ? "Prüfe …" : "Jetzt prüfen"}
            </button>
            <div className="flex overflow-hidden rounded-md border border-gray-300 text-xs">
              {(["liste", "diagramm"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 font-medium ${
                    view === v ? "bg-brand-red text-white" : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {v === "liste" ? "Liste" : "Diagramm"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="rounded-md bg-brand-red px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
            >
              {open ? "Schließen" : "+ Neue Regel"}
            </button>
          </div>
        </div>

        {open && (
          <form action={formAction} className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4">
            <RuleFields users={users} editableTrigger />

            <div className="flex items-center gap-3">
              <button type="submit" disabled={pending} className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                {pending ? "Speichert …" : "Regel anlegen"}
              </button>
              {state.error && <span className="text-sm text-rose-600">{state.error}</span>}
              {state.success && <span className="text-sm text-emerald-600">{state.success}</span>}
            </div>
          </form>
        )}

        {workflows.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-gray-500">Noch keine Regeln angelegt.</p>
        ) : view === "liste" ? (
          <ul className="divide-y divide-gray-200">
            {workflows.map((wf) => (
              <WorkflowRow key={wf.id} wf={wf} users={users} />
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-3 px-5 py-4">
            {workflows.map((wf) => (
              <WorkflowFlow key={wf.id} wf={wf} users={users} />
            ))}
          </div>
        )}
      </div>

      {/* Protokoll */}
      <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-medium text-gray-900">Protokoll (letzte Aktionen)</h2>
        </div>
        {log.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-gray-500">Noch keine Aktionen.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {log.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 px-5 py-2 text-sm">
                <span className="text-xs text-gray-400">{fmtStamp(l.createdAt)}</span>
                <span className="text-gray-700">{l.detail}</span>
                {l.ref && <span className="text-xs text-gray-400">Beleg {l.ref}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
