"use client";

import { useActionState, useState } from "react";
import {
  createWorkflowAction,
  updateWorkflowAction,
  toggleWorkflowAction,
  deleteWorkflowAction,
  type WorkflowFormState,
} from "@/app/dashboard/workflows/actions";
import type { Workflow, WorkflowConfig, WorkflowLogItem } from "@/lib/workflows";

interface UserOption {
  id: number;
  name: string;
}

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60";

function fmtStamp(s: string | null): string {
  if (!s) return "";
  const d = new Date(s.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Felder für Auslöser „Neuer Beleg" → Aktion „Aufgabe erstellen". */
function RuleFields({ users, name, cfg }: { users: UserOption[]; name?: string; cfg?: Partial<WorkflowConfig> }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="mb-1 block text-sm text-gray-600">Name der Regel *</label>
        <input name="name" defaultValue={name ?? ""} required placeholder="z.B. Belegprüfung Büro" className={inputClass} />
      </div>
      <div>
        <label className="mb-1 block text-sm text-gray-600">Auslöser</label>
        <input value="Neuer Beleg (Eingangsrechnung)" disabled className={`${inputClass} opacity-60`} />
      </div>
      <div>
        <label className="mb-1 block text-sm text-gray-600">Aufgabe an *</label>
        <select name="assigneeId" defaultValue={cfg?.assigneeId ?? ""} required className={inputClass}>
          <option value="">Mitarbeiter wählen …</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-sm text-gray-600">
          Aufgaben-Titel <span className="text-gray-400">(Platzhalter: {"{nr} {lieferant} {betrag} {datum}"})</span>
        </label>
        <input name="title" defaultValue={cfg?.title ?? "Beleg prüfen: {nr} – {lieferant}"} className={inputClass} />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-sm text-gray-600">Beschreibung (optional)</label>
        <textarea name="description" defaultValue={cfg?.description ?? ""} rows={2} className={inputClass} />
      </div>
      <div>
        <label className="mb-1 block text-sm text-gray-600">Fällig in (Tagen)</label>
        <input name="dueOffsetDays" type="number" min={0} defaultValue={cfg?.dueOffsetDays ?? 7} className={inputClass} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-sm text-gray-600">Filter: Lieferant</label>
          <input name="filterSupplier" defaultValue={cfg?.filterSupplier ?? ""} placeholder="enthält …" className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-600">Filter: ab Betrag €</label>
          <input name="filterMinAmount" type="number" min={0} step="0.01" defaultValue={cfg?.filterMinAmount ?? ""} className={inputClass} />
        </div>
      </div>
    </div>
  );
}

function WorkflowRow({ wf, users }: { wf: Workflow; users: UserOption[] }) {
  const [editing, setEditing] = useState(false);
  const assignee = users.find((u) => u.id === wf.config.assigneeId)?.name ?? `#${wf.config.assigneeId}`;

  if (editing) {
    return (
      <li className="bg-gray-50 px-5 py-4">
        <form action={updateWorkflowAction} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={wf.id} />
          <RuleFields users={users} name={wf.name} cfg={wf.config} />
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
          Neuer Beleg → Aufgabe an <span className="text-gray-700">{assignee}</span> · fällig in{" "}
          {wf.config.dueOffsetDays} Tagen
          {wf.config.filterSupplier ? ` · Lieferant „${wf.config.filterSupplier}"` : ""}
          {wf.config.filterMinAmount != null ? ` · ab ${wf.config.filterMinAmount} €` : ""}
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
  const [state, formAction, pending] = useActionState<WorkflowFormState, FormData>(createWorkflowAction, {});

  return (
    <div className="flex flex-col gap-6">
      {/* Neue Regel */}
      <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-medium text-gray-900">Regeln</h2>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="rounded-md bg-brand-red px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
          >
            {open ? "Schließen" : "+ Neue Regel"}
          </button>
        </div>

        {open && (
          <form action={formAction} className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4">
            <RuleFields users={users} />
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
        ) : (
          <ul className="divide-y divide-gray-200">
            {workflows.map((wf) => (
              <WorkflowRow key={wf.id} wf={wf} users={users} />
            ))}
          </ul>
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
