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

async function requireAdmin(): Promise<number | null> {
  const session = await getSession();
  if (!session || session.role !== "administrator") return null;
  try {
    return (await getUserByUsername(session.username))?.id ?? null;
  } catch {
    return null;
  }
}

function readConfig(formData: FormData): WorkflowConfig {
  const num = (v: FormDataEntryValue | null) => {
    const s = String(v ?? "").trim().replace(",", ".");
    return s !== "" && Number.isFinite(Number(s)) ? Number(s) : null;
  };
  return {
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
  };
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
  if (!config.assigneeId) return { error: "Bitte einen Mitarbeiter wählen." };
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
  const config = readConfig(formData);
  if (!config.assigneeId) return;
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
