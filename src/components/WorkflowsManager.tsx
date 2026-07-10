"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createWorkflowAction,
  updateWorkflowAction,
  toggleWorkflowAction,
  deleteWorkflowAction,
  runWorkflowsNowAction,
  type WorkflowFormState,
} from "@/app/dashboard/workflows/actions";
import type { Workflow, WorkflowConfig, WorkflowLogItem, WorkflowRun } from "@/lib/workflows";

interface UserOption {
  id: number;
  name: string;
}

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60";

const TRIGGER_OPTIONS = [
  { key: "new_beleg", label: "Neuer Beleg (Eingangsrechnung)" },
  { key: "new_manual_beleg", label: "Neuer erfasster Beleg (Posteingang/manuell)" },
  { key: "angebot_alt_ohne_ab", label: "Angebot zu alt ohne AB (Pipeline 'Angebot offen')" },
  { key: "stunden_ohne_abschlag", label: "Stunden gebucht, aber keine Abschlagsrechnung" },
  { key: "endrechnung", label: "Endrechnung erstellt (Schluss-/Vollrechnung, keine Teil-/Abschlagsrechnung)" },
] as const;

function triggerLabel(key: string): string {
  return TRIGGER_OPTIONS.find((t) => t.key === key)?.label ?? key;
}
function placeholdersFor(key: string): string {
  if (key === "angebot_alt_ohne_ab") return "{projekt} {nr} {kunde} {betrag} {tage} {angebotsdatum}";
  if (key === "stunden_ohne_abschlag") return "{projekt} {nr} {kunde} {stunden} {mitarbeiter} {zeitraum}";
  if (key === "endrechnung") return "{kunde} {nr} {projekt} {betrag} {datum}";
  return "{nr} {lieferant} {betrag} {datum}";
}
function defaultTitleFor(key: string): string {
  if (key === "angebot_alt_ohne_ab") return "Angebot nachfassen: {projekt} ({tage} Tage alt)";
  if (key === "stunden_ohne_abschlag") return "Abschlagsrechnung erstellen: {projekt} {nr} ({stunden} h)";
  if (key === "endrechnung") return "Kunde anrufen – Zufriedenheit erfragen: {kunde} ({projekt})";
  return "Beleg prüfen: {nr} – {lieferant}";
}

function fmtStamp(s: string | null): string {
  if (!s) return "";
  const d = new Date(s.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Auswahlliste der Lieferanten (Mehrfachauswahl per Checkbox, durchsuchbar). */
function SupplierMultiSelect({ suppliers, selected }: { suppliers: string[]; selected: string[] }) {
  const [chosen, setChosen] = useState<string[]>(selected);
  const [q, setQ] = useState("");
  // Bereits gewählte Lieferanten immer zeigen, auch wenn sie nicht (mehr) in der Liste sind.
  const all = useMemo(() => Array.from(new Set([...selected, ...suppliers])), [suppliers, selected]);
  const filtered = all.filter((s) => s.toLowerCase().includes(q.toLowerCase()));
  const toggle = (s: string) => setChosen((c) => (c.includes(s) ? c.filter((x) => x !== s) : [...c, s]));
  return (
    <div>
      {chosen.map((s) => (
        <input key={s} type="hidden" name="excludedSuppliers" value={s} />
      ))}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Lieferant suchen …" className={inputClass} />
      <div className="mt-1 max-h-44 overflow-y-auto rounded-md border border-gray-300">
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-xs text-gray-400">Keine Lieferanten gefunden.</p>
        ) : (
          filtered.map((s) => (
            <label
              key={s}
              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              <input type="checkbox" checked={chosen.includes(s)} onChange={() => toggle(s)} />
              <span className="truncate">{s}</span>
            </label>
          ))
        )}
      </div>
      <p className="mt-1 text-xs text-gray-400">{chosen.length > 0 ? `${chosen.length} ausgewählt` : "Keine ausgewählt"}</p>
    </div>
  );
}

/** Felder einer Regel (Auslöser → Aktion „Aufgabe erstellen"). */
function RuleFields({
  users,
  suppliers,
  name,
  cfg,
  triggerKey = "new_beleg",
  editableTrigger = false,
}: {
  users: UserOption[];
  suppliers: string[];
  name?: string;
  cfg?: Partial<WorkflowConfig>;
  triggerKey?: string;
  editableTrigger?: boolean;
}) {
  const [trigger, setTrigger] = useState(triggerKey);
  const [title, setTitle] = useState(cfg?.title ?? defaultTitleFor(triggerKey));
  const [actionType, setActionType] = useState<"task" | "review">(cfg?.actionType === "review" ? "review" : "task");
  const isAngebot = trigger === "angebot_alt_ohne_ab";
  const isStunden = trigger === "stunden_ohne_abschlag";
  const isEndrechnung = trigger === "endrechnung";
  const isReview = trigger === "new_beleg" && actionType === "review";
  const kundeLabel = isAngebot || isStunden || isEndrechnung ? "Kunde" : "Lieferant";

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

      {/* Verkettung: Rechnungsbuchung (Posteingang) → Rechnungsprüfung */}
      {trigger === "new_manual_beleg" && (
        <label className="sm:col-span-2 flex items-start gap-2 rounded-md border border-amber-400/40 bg-amber-50 px-3 py-2 text-xs text-gray-700">
          <input
            type="checkbox"
            name="chainReview"
            defaultChecked={cfg?.chainReview === true}
            className="mt-0.5 accent-brand-red"
          />
          <span>
            <strong>Nach Erledigung Rechnungsprüfung starten:</strong> Wird die erzeugte Aufgabe auf
            „erledigt" gesetzt, wird für denselben Beleg automatisch die Rechnungsprüfung angelegt
            (Prüfer aus der aktiven Rechnungsprüfungs-Regel) – inkl. PDF-Vorschau und „Geprüft &amp;
            abschließen".
          </span>
        </label>
      )}

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
        {isStunden && (
          <p className="mt-1 text-xs text-gray-400">
            Projektnummer, Stundensumme sowie <strong>wer</strong> die Stunden erfasst hat und der{" "}
            <strong>Zeitraum</strong> werden automatisch an die Aufgabe angehängt.
          </p>
        )}
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
          {isStunden
            ? "Regel ab diesem Datum aktiv (greift dann auch bestehende Projekte ab)."
            : `Nur Ereignisse ab diesem Datum (${isAngebot ? "Angebotsdatum" : "Belegdatum"}) lösen aus.`}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-sm text-gray-600">Filter: {kundeLabel}</label>
          <input name="filterSupplier" defaultValue={cfg?.filterSupplier ?? ""} placeholder="enthält …" className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-600">
            {isStunden ? "Filter: ab Stunden" : `Filter: ab ${isAngebot ? "Angebotssumme" : "Betrag"} €`}
          </label>
          <input name="filterMinAmount" type="number" min={0} step={isStunden ? "0.5" : "0.01"} defaultValue={cfg?.filterMinAmount ?? ""} className={inputClass} />
        </div>
      </div>

      {/* Manuelle Belege ausschließen (nur Beleg-Auslöser) */}
      {trigger === "new_beleg" && (
        <div className="sm:col-span-2">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" name="excludeManual" value="1" defaultChecked={cfg?.excludeManual ?? false} />
            Manuelle Belege ausschließen <span className="text-gray-400">(Belege ohne hinterlegtes Dokument)</span>
          </label>
        </div>
      )}

      {/* Split nach Lieferant: ausgewaehlte Lieferanten gehen an einen anderen Bearbeiter */}
      <div className="sm:col-span-2 rounded-md border border-gray-200 p-3">
        <p className="mb-2 text-sm font-medium text-gray-700">
          Lieferanten-Split <span className="font-normal text-gray-400">(optional)</span>
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-gray-600">Ausgeschlossene Lieferanten</label>
            <SupplierMultiSelect suppliers={suppliers} selected={cfg?.excludedSuppliers ?? []} />
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

function WorkflowRow({ wf, users, suppliers }: { wf: Workflow; users: UserOption[]; suppliers: string[] }) {
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
          <RuleFields users={users} suppliers={suppliers} name={wf.name} cfg={wf.config} triggerKey={wf.triggerKey} />
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
            : wf.triggerKey === "stunden_ohne_abschlag"
              ? "Stunden gebucht, keine Abschlagsrechnung"
              : wf.triggerKey === "endrechnung"
                ? "Endrechnung erstellt"
                : "Neuer Beleg"}{" "}
          → {wf.config.actionType === "review" ? "Rechnungsprüfung" : "Aufgabe"} an{" "}
          <span className="text-gray-700">{assignee}</span>
          {wf.config.actionType === "review" ? "" : ` · fällig in ${wf.config.dueOffsetDays} Tagen`}
          {wf.config.filterSupplier
            ? ` · ${wf.triggerKey === "angebot_alt_ohne_ab" ? "Kunde" : "Lieferant"} „${wf.config.filterSupplier}"`
            : ""}
          {wf.config.filterMinAmount != null ? ` · ab ${wf.config.filterMinAmount} €` : ""}
          {wf.config.validFrom ? ` · gültig ab ${wf.config.validFrom.split("-").reverse().join(".")}` : ""}
          {wf.config.excludeManual ? " · ohne manuelle Belege" : ""}
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
  kind: "trigger" | "condition" | "action" | "followup";
  title: string;
  lines: string[];
}) {
  const box =
    kind === "trigger"
      ? "border-sky-500/30 bg-sky-500/10"
      : kind === "condition"
        ? "border-amber-500/30 bg-amber-500/10"
        : kind === "followup"
          ? "border-indigo-500/30 bg-indigo-500/10"
          : "border-emerald-500/30 bg-emerald-500/10";
  const titleColor =
    kind === "trigger"
      ? "text-sky-300"
      : kind === "condition"
        ? "text-amber-300"
        : kind === "followup"
          ? "text-indigo-300"
          : "text-emerald-300";
  const icon = kind === "trigger" ? "🧾" : kind === "condition" ? "⚙️" : kind === "followup" ? "📦" : "✅";
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

/** Ablauf-Diagramm einer Regel: Auslöser → (Bedingung) → Aktion (mit Lieferanten-Split). */
function WorkflowFlow({ wf, users }: { wf: Workflow; users: UserOption[] }) {
  const assignee = users.find((u) => u.id === wf.config.assigneeId)?.name ?? `#${wf.config.assigneeId}`;
  const isAngebot = wf.triggerKey === "angebot_alt_ohne_ab";
  const isStunden = wf.triggerKey === "stunden_ohne_abschlag";
  const isEndrechnung = wf.triggerKey === "endrechnung";
  const isReview = wf.config.actionType === "review";
  const triggerLines = isAngebot
    ? ["Angebot offen", `älter ${wf.config.minAgeDays ?? 21} Tage`, "kein AB"]
    : isStunden
      ? ["Stunden gebucht", "keine Abschlags-", "rechnung"]
      : isEndrechnung
        ? ["Endrechnung", "Kundenrechnung"]
        : ["Neuer Beleg", "Eingangsrechnung"];
  const conditions: string[] = [];
  if (wf.config.filterSupplier)
    conditions.push(`${isAngebot || isStunden || isEndrechnung ? "Kunde" : "Lieferant"} „${wf.config.filterSupplier}"`);
  if (wf.config.filterMinAmount != null)
    conditions.push(isStunden ? `ab ${wf.config.filterMinAmount} h` : `ab ${wf.config.filterMinAmount} €`);
  if (wf.config.excludeManual) conditions.push("ohne manuelle Belege");

  const excludedName = wf.config.excludedAssigneeId
    ? users.find((u) => u.id === wf.config.excludedAssigneeId)?.name ?? `#${wf.config.excludedAssigneeId}`
    : null;
  const hasSplit = wf.config.excludedSuppliers.length > 0 && !!excludedName;
  const actionVerb = isReview ? "Prüfung" : "Aufgabe";
  const mainAction = isReview
    ? ["Rechnungsprüfung", "Beleg → Prüfung", `Prüfer ${assignee}`]
    : [`Aufgabe an ${assignee}`, `fällig in ${wf.config.dueOffsetDays} Tagen`];

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
        {hasSplit ? (
          <>
            <FlowNode
              kind="condition"
              title="Lieferanten-Split"
              lines={["Lieferant ausgewählt?", `${wf.config.excludedSuppliers.length} Lieferant(en)`]}
            />
            <div className="flex shrink-0 flex-col justify-center gap-2 self-stretch">
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-emerald-400">ja →</span>
                <FlowNode kind="action" title={`${actionVerb} (Split)`} lines={[`${isReview ? "Prüfer" : "an"} ${excludedName}`, wf.config.excludedSuppliers.join(", ")]} />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-gray-400">sonst →</span>
                <FlowNode kind="action" title="Aktion" lines={mainAction} />
              </div>
            </div>
          </>
        ) : (
          <FlowNode kind="action" title="Aktion" lines={mainAction} />
        )}
        {isReview && (
          <>
            <FlowArrow />
            <FlowNode
              kind="followup"
              title="Nach Freigabe"
              lines={["Beleg-Artikel →", "Soll-Kalkulation zuordnen"]}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default function WorkflowsManager({
  workflows,
  users,
  log,
  runs,
  suppliers,
}: {
  workflows: Workflow[];
  users: UserOption[];
  log: WorkflowLogItem[];
  runs: WorkflowRun[];
  suppliers: string[];
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
            <RuleFields users={users} suppliers={suppliers} editableTrigger />

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
              <WorkflowRow key={wf.id} wf={wf} users={users} suppliers={suppliers} />
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

      {/* Dienst-Historie (Läufe der automatischen Prüfung) */}
      <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-medium text-gray-900">Dienst-Historie (Prüfläufe)</h2>
          <span className="text-xs text-gray-500">Läuft automatisch alle 10 Minuten</span>
        </div>
        {runs.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-gray-500">Noch keine Läufe protokolliert.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 text-sm">
                <span className={`h-2 w-2 shrink-0 rounded-full ${r.error ? "bg-rose-500" : "bg-emerald-500"}`} />
                <span className="text-xs text-gray-500">{fmtStamp(r.ranAt)}</span>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                  {r.source === "timer" ? "automatisch" : r.source === "manuell" ? "manuell" : r.source}
                </span>
                <span className="text-gray-700">
                  geprüft: {r.checked} · erstellt: {r.created}
                </span>
                {r.error && <span className="text-xs text-rose-600">Fehler: {r.error}</span>}
              </li>
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
