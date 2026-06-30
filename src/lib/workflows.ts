import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { getPool } from "./db";

/** Aktuell unterstützte Auslöser. */
export const WORKFLOW_TRIGGERS = [{ key: "new_beleg", label: "Neuer Beleg (Eingangsrechnung)" }] as const;

/** Aktion „Aufgabe erstellen" – Konfiguration einer Regel. */
export interface WorkflowConfig {
  assigneeId: number;
  /** Titel-Vorlage, Platzhalter: {nr} {lieferant} {betrag} {datum}. */
  title: string;
  description: string | null;
  /** Fälligkeit in Tagen ab Auslösung. */
  dueOffsetDays: number;
  /** Optionaler Filter: Lieferantenname enthält … */
  filterSupplier: string | null;
  /** Optionaler Filter: Mindest-Bruttobetrag. */
  filterMinAmount: number | null;
}

export interface Workflow {
  id: number;
  name: string;
  triggerKey: string;
  config: WorkflowConfig;
  active: boolean;
  createdBy: number | null;
}

interface WorkflowRow extends RowDataPacket {
  id: number;
  name: string;
  trigger_key: string;
  config: unknown;
  active: number;
  created_by: number | null;
}

function parseConfig(value: unknown): WorkflowConfig {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = {};
    }
  }
  const o = (raw ?? {}) as Partial<WorkflowConfig>;
  return {
    assigneeId: Number(o.assigneeId ?? 0),
    title: String(o.title ?? "Beleg prüfen: {nr} – {lieferant}"),
    description: o.description != null ? String(o.description) : null,
    dueOffsetDays: Number.isFinite(Number(o.dueOffsetDays)) ? Number(o.dueOffsetDays) : 7,
    filterSupplier: o.filterSupplier ? String(o.filterSupplier) : null,
    filterMinAmount:
      o.filterMinAmount != null && Number.isFinite(Number(o.filterMinAmount))
        ? Number(o.filterMinAmount)
        : null,
  };
}

function mapRow(r: WorkflowRow): Workflow {
  return {
    id: r.id,
    name: r.name,
    triggerKey: r.trigger_key,
    config: parseConfig(r.config),
    active: r.active === 1,
    createdBy: r.created_by,
  };
}

export async function listWorkflows(): Promise<Workflow[]> {
  const [rows] = await getPool().query<WorkflowRow[]>(
    "SELECT id, name, trigger_key, config, active, created_by FROM workflows ORDER BY id DESC"
  );
  return rows.map(mapRow);
}

export async function listActiveWorkflows(triggerKey: string): Promise<Workflow[]> {
  const [rows] = await getPool().query<WorkflowRow[]>(
    "SELECT id, name, trigger_key, config, active, created_by FROM workflows WHERE trigger_key = ? AND active = 1",
    [triggerKey]
  );
  return rows.map(mapRow);
}

export async function createWorkflow(input: {
  name: string;
  triggerKey: string;
  config: WorkflowConfig;
  createdBy: number | null;
}): Promise<number> {
  const [res] = await getPool().query<ResultSetHeader>(
    "INSERT INTO workflows (name, trigger_key, config, created_by) VALUES (?, ?, ?, ?)",
    [input.name.slice(0, 160), input.triggerKey, JSON.stringify(input.config), input.createdBy]
  );
  return res.insertId;
}

export async function updateWorkflow(id: number, input: { name: string; config: WorkflowConfig }): Promise<void> {
  await getPool().query("UPDATE workflows SET name = ?, config = ? WHERE id = ?", [
    input.name.slice(0, 160),
    JSON.stringify(input.config),
    id,
  ]);
}

export async function setWorkflowActive(id: number, active: boolean): Promise<void> {
  await getPool().query("UPDATE workflows SET active = ? WHERE id = ?", [active ? 1 : 0, id]);
}

export async function deleteWorkflow(id: number): Promise<void> {
  await getPool().query("DELETE FROM workflows WHERE id = ?", [id]);
}

// --- Status (Throttle + Seeding) ---

export async function getWorkflowMeta(triggerKey: string): Promise<{ lastRun: Date | null; seeded: boolean }> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT last_run, seeded FROM workflow_meta WHERE trigger_key = ? LIMIT 1",
    [triggerKey]
  );
  const r = rows[0] as { last_run: string | Date | null; seeded: number } | undefined;
  if (!r) return { lastRun: null, seeded: false };
  return { lastRun: r.last_run ? new Date(r.last_run) : null, seeded: r.seeded === 1 };
}

export async function touchWorkflowLastRun(triggerKey: string): Promise<void> {
  await getPool().query(
    `INSERT INTO workflow_meta (trigger_key, last_run) VALUES (?, NOW())
     ON DUPLICATE KEY UPDATE last_run = NOW()`,
    [triggerKey]
  );
}

export async function setWorkflowSeeded(triggerKey: string): Promise<void> {
  await getPool().query(
    `INSERT INTO workflow_meta (trigger_key, seeded) VALUES (?, 1)
     ON DUPLICATE KEY UPDATE seeded = 1`,
    [triggerKey]
  );
}

// --- Gesehene Referenzen (bereits verarbeitete Belege) ---

export async function getSeenRefs(triggerKey: string): Promise<Set<string>> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT ref FROM workflow_seen WHERE trigger_key = ?",
    [triggerKey]
  );
  return new Set((rows as { ref: string }[]).map((r) => r.ref));
}

export async function markSeen(triggerKey: string, refs: string[]): Promise<void> {
  if (refs.length === 0) return;
  await getPool().query(
    `INSERT IGNORE INTO workflow_seen (trigger_key, ref) VALUES ?`,
    [refs.map((ref) => [triggerKey, ref])]
  );
}

// --- Protokoll ---

export interface WorkflowLogItem {
  id: number;
  workflowId: number | null;
  ref: string | null;
  detail: string | null;
  createdAt: string | null;
}

export async function addWorkflowLog(workflowId: number | null, ref: string | null, detail: string): Promise<void> {
  await getPool().query(
    "INSERT INTO workflow_log (workflow_id, ref, detail) VALUES (?, ?, ?)",
    [workflowId, ref?.slice(0, 64) ?? null, detail.slice(0, 255)]
  );
}

export async function listWorkflowLog(limit = 30): Promise<WorkflowLogItem[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT id, workflow_id, ref, detail, created_at FROM workflow_log ORDER BY id DESC LIMIT ?",
    [limit]
  );
  return (rows as { id: number; workflow_id: number | null; ref: string | null; detail: string | null; created_at: string | null }[]).map((r) => ({
    id: r.id,
    workflowId: r.workflow_id,
    ref: r.ref,
    detail: r.detail,
    createdAt: r.created_at ? String(r.created_at) : null,
  }));
}
