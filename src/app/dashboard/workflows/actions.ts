"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import {
  createWorkflow,
  updateWorkflow,
  setWorkflowActive,
  deleteWorkflow,
  WORKFLOW_TRIGGER_KEYS,
  type WorkflowConfig,
} from "@/lib/workflows";
import { REPEAT_KINDS, type RepeatKind } from "@/lib/workflow-schedule";
import { runWorkflowScan } from "@/lib/workflow-engine";

const PATH = "/dashboard/workflows";

/** Wird bei App-Nutzung aufgerufen (gedrosselt). Best-effort. */
export async function triggerWorkflowScan(): Promise<void> {
  if (!(await getSession())) return;
  try {
    await runWorkflowScan();
  } catch {
    /* still */
  }
}

export interface RunNowResult {
  ok: boolean;
  created: number;
  checked: number;
  error?: string;
}

/** Admin: führt die Workflow-Prüfung sofort aus (umgeht die Drossel). */
export async function runWorkflowsNowAction(): Promise<RunNowResult> {
  const session = await getSession();
  if (!session || session.role !== "administrator") return { ok: false, created: 0, checked: 0, error: "Kein Zugriff." };
  try {
    const r = await runWorkflowScan(true, "manuell");
    revalidatePath(PATH);
    return { ok: true, created: r.created, checked: r.checked };
  } catch (e) {
    return { ok: false, created: 0, checked: 0, error: e instanceof Error ? e.message : "Fehler beim Ausführen." };
  }
}

async function requireAdmin(): Promise<number | null> {
  const session = await getSession();
  if (!session || session.role !== "administrator") return null;
  try {
    return (await getUserByUsername(session.username))?.id ?? null;
  } catch {
    return null;
  }
}

/** Liest die Buchungskonto→Prüfer-Zuordnungen (JSON-Hidden-Input) defensiv ein. */
function parseAccountReviewers(v: FormDataEntryValue | null): { account: string; assigneeId: number }[] {
  try {
    const raw = JSON.parse(String(v ?? "[]"));
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw
      .map((m) => ({ account: String(m?.account ?? "").trim(), assigneeId: Number(m?.assigneeId) }))
      .filter((m) => {
        if (!m.account || !Number.isFinite(m.assigneeId) || m.assigneeId <= 0) return false;
        if (seen.has(m.account)) return false; // je Konto nur eine Zuordnung
        seen.add(m.account);
        return true;
      })
      .slice(0, 200);
  } catch {
    return [];
  }
}

function readConfig(formData: FormData): WorkflowConfig {
  const num = (v: FormDataEntryValue | null) => {
    const s = String(v ?? "").trim().replace(",", ".");
    return s !== "" && Number.isFinite(Number(s)) ? Number(s) : null;
  };
  return {
    actionType: String(formData.get("actionType")) === "review" ? "review" : "task",
    assigneeId: Number(formData.get("assigneeId")) || 0,
    title: String(formData.get("title") ?? "").trim() || "Beleg prüfen: {nr} – {lieferant}",
    description: String(formData.get("description") ?? "").trim() || null,
    dueOffsetDays: num(formData.get("dueOffsetDays")) ?? 7,
    filterSupplier: String(formData.get("filterSupplier") ?? "").trim() || null,
    filterMinAmount: num(formData.get("filterMinAmount")),
    minAgeDays: num(formData.get("minAgeDays")),
    buttons: String(formData.get("buttons") ?? "")
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8),
    validFrom: /^\d{4}-\d{2}-\d{2}$/.test(String(formData.get("validFrom") ?? ""))
      ? String(formData.get("validFrom"))
      : null,
    excludedSuppliers: Array.from(new Set(formData.getAll("excludedSuppliers").map((s) => String(s).trim()).filter(Boolean))).slice(0, 100),
    excludedAssigneeId: Number(formData.get("excludedAssigneeId")) > 0 ? Number(formData.get("excludedAssigneeId")) : null,
    excludeManual: formData.get("excludeManual") === "on" || formData.get("excludeManual") === "1",
    chainReview: formData.get("chainReview") === "on" || formData.get("chainReview") === "1",
    // Rechnungsprüfung: Buchungskonto → Prüfer (JSON aus dem UI-Editor).
    accountReviewers: parseAccountReviewers(formData.get("accountReviewers")),
    // --- logbuch_abschluss ---
    keyword: String(formData.get("keyword") ?? "").trim() || null,
    customerFilters: Array.from(
      new Set(formData.getAll("customerFilters").map((s) => String(s).trim()).filter(Boolean))
    ).slice(0, 200),
    mailUserIds: Array.from(
      new Set(formData.getAll("mailUserIds").map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0))
    ),
    mailExtraEmails: Array.from(
      new Set(
        String(formData.get("mailExtraEmails") ?? "")
          .split(/[\n,;]/)
          .map((s) => s.trim())
          .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))
      )
    ).slice(0, 50),
    taskUserIds: Array.from(
      new Set(formData.getAll("taskUserIds").map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0))
    ),
    // Zeitplan der wiederkehrenden Aufgabe (parseConfig begrenzt die Werte nochmal).
    repeatKind: REPEAT_KINDS.some((r) => r.key === String(formData.get("repeatKind")))
      ? (String(formData.get("repeatKind")) as RepeatKind)
      : "weekly",
    repeatWeekday: num(formData.get("repeatWeekday")) ?? 1,
    repeatDayOfMonth: num(formData.get("repeatDayOfMonth")) ?? 1,
    repeatEveryDays: num(formData.get("repeatEveryDays")) ?? 14,
  };
}

/** Pflichtfelder je Auslöser prüfen. Gibt eine Fehlermeldung oder null zurück. */
function validateConfig(triggerKey: string, config: WorkflowConfig): string | null {
  if (triggerKey === "logbuch_abschluss") {
    if (config.taskUserIds.length === 0) return "Bitte mindestens einen Zuständigen für die Aufgabe wählen.";
    if (config.mailUserIds.length === 0 && config.mailExtraEmails.length === 0)
      return "Bitte mindestens einen E-Mail-Empfänger angeben (interner Nutzer oder externe Adresse).";
    return null;
  }
  if (!config.assigneeId) return "Bitte einen Mitarbeiter wählen.";
  return null;
}

export interface WorkflowFormState {
  error?: string;
  success?: string;
}

export async function createWorkflowAction(
  _prev: WorkflowFormState,
  formData: FormData
): Promise<WorkflowFormState> {
  const adminId = await requireAdmin();
  if (adminId == null) return { error: "Kein Zugriff." };
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Bitte einen Namen angeben." };
  const triggerKey = String(formData.get("triggerKey") ?? "new_beleg");
  if (!WORKFLOW_TRIGGER_KEYS.includes(triggerKey as (typeof WORKFLOW_TRIGGER_KEYS)[number])) {
    return { error: "Unbekannter Auslöser." };
  }
  const config = readConfig(formData);
  const cfgError = validateConfig(triggerKey, config);
  if (cfgError) return { error: cfgError };
  try {
    await createWorkflow({ name, triggerKey, config, createdBy: adminId });
  } catch {
    return { error: "Regel konnte nicht gespeichert werden." };
  }
  revalidatePath(PATH);
  return { success: "Regel angelegt." };
}

export async function updateWorkflowAction(formData: FormData): Promise<void> {
  if ((await requireAdmin()) == null) return;
  const id = Number(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  if (!Number.isFinite(id) || !name) return;
  const triggerKey = String(formData.get("triggerKey") ?? "");
  const config = readConfig(formData);
  if (validateConfig(triggerKey, config)) return;
  await updateWorkflow(id, { name, config });
  revalidatePath(PATH);
}

export async function toggleWorkflowAction(formData: FormData): Promise<void> {
  if ((await requireAdmin()) == null) return;
  const id = Number(formData.get("id"));
  const active = String(formData.get("active")) === "1";
  if (!Number.isFinite(id)) return;
  await setWorkflowActive(id, active);
  revalidatePath(PATH);
}

export async function deleteWorkflowAction(formData: FormData): Promise<void> {
  if ((await requireAdmin()) == null) return;
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  await deleteWorkflow(id);
  revalidatePath(PATH);
}
