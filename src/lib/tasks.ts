import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";
import { writeProjectLogbook } from "./hero-api";
import {
  TASK_STATUSES,
  taskStatusLabel,
  type Task,
  type TaskAssignee,
  type TaskHistoryEntry,
  type TaskStatus,
} from "./task-types";

// Re-export the client-safe symbols so existing server-side imports keep working.
export { TASK_STATUSES, taskStatusLabel };
export type { Task, TaskAssignee, TaskHistoryEntry, TaskStatus };

interface TaskRow extends RowDataPacket {
  id: number;
  title: string;
  description: string | null;
  status: string;
  due_date: string | null;
  created_by: number;
  created_at: string | null;
  created_by_name: string;
  project_id: number | null;
  project_relative_id: number | null;
  project_name: string | null;
  action_buttons: unknown;
}

function parseButtons(value: unknown): string[] {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x)).filter((s) => s.trim().length > 0);
}

interface AssigneeRow extends RowDataPacket {
  task_id: number;
  id: number;
  name: string;
}

interface HistoryRow extends RowDataPacket {
  task_id: number;
  id: number;
  action: string;
  detail: string | null;
  by_name: string | null;
  created_at: string | null;
}

/** Writes a single history entry for a task. */
async function addHistory(
  taskId: number,
  userId: number | null,
  action: string,
  detail: string | null
): Promise<void> {
  await getPool().query(
    "INSERT INTO task_history (task_id, user_id, action, detail) VALUES (?, ?, ?, ?)",
    [taskId, userId, action, detail]
  );
}

const SELECT = `
  SELECT t.id, t.title, t.description, t.status, t.due_date, t.created_by, t.created_at,
         t.project_id, t.project_relative_id, t.project_name, t.action_buttons,
         COALESCE(NULLIF(cu.display_name, ''), cu.username) AS created_by_name
  FROM tasks t
  JOIN users cu ON cu.id = t.created_by
`;

// Offene/laufende zuerst, dann nach Fälligkeit, dann neueste zuerst.
const ORDER = `
  ORDER BY (t.status = 'erledigt') ASC, (t.due_date IS NULL) ASC, t.due_date ASC, t.created_at DESC
`;

/** Attaches the assignee list to a set of task rows. */
async function hydrate(rows: TaskRow[]): Promise<Task[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [assigneeRows] = await getPool().query<AssigneeRow[]>(
    `SELECT ta.task_id, u.id, COALESCE(NULLIF(u.display_name, ''), u.username) AS name
     FROM task_assignees ta JOIN users u ON u.id = ta.user_id
     WHERE ta.task_id IN (?)
     ORDER BY name`,
    [ids]
  );
  const byTask = new Map<number, TaskAssignee[]>();
  for (const a of assigneeRows) {
    const list = byTask.get(a.task_id) ?? [];
    list.push({ id: a.id, name: a.name });
    byTask.set(a.task_id, list);
  }

  const [historyRows] = await getPool().query<HistoryRow[]>(
    `SELECT h.task_id, h.id, h.action, h.detail, h.created_at,
            COALESCE(NULLIF(u.display_name, ''), u.username) AS by_name
     FROM task_history h LEFT JOIN users u ON u.id = h.user_id
     WHERE h.task_id IN (?)
     ORDER BY h.created_at ASC, h.id ASC`,
    [ids]
  );
  const historyByTask = new Map<number, TaskHistoryEntry[]>();
  for (const h of historyRows) {
    const list = historyByTask.get(h.task_id) ?? [];
    list.push({
      id: h.id,
      action: h.action,
      detail: h.detail,
      byName: h.by_name,
      at: h.created_at ? String(h.created_at) : null,
    });
    historyByTask.set(h.task_id, list);
  }

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    status: (r.status as TaskStatus) ?? "offen",
    dueDate: r.due_date ? String(r.due_date).slice(0, 10) : null,
    createdById: r.created_by,
    createdByName: r.created_by_name,
    assignees: byTask.get(r.id) ?? [],
    history: historyByTask.get(r.id) ?? [],
    projectId: r.project_id,
    projectRelativeId: r.project_relative_id,
    projectName: r.project_name,
    createdAt: r.created_at ? String(r.created_at) : null,
    actionButtons: parseButtons(r.action_buttons),
  }));
}

/** Tasks assigned to a user (their to-do list). */
export async function listTasksAssignedTo(userId: number): Promise<Task[]> {
  const [rows] = await getPool().query<TaskRow[]>(
    `${SELECT} WHERE EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?) ${ORDER}`,
    [userId]
  );
  return hydrate(rows);
}

/** Tasks a user created (sent to others). */
export async function listTasksCreatedBy(userId: number): Promise<Task[]> {
  const [rows] = await getPool().query<TaskRow[]>(`${SELECT} WHERE t.created_by = ? ${ORDER}`, [
    userId,
  ]);
  return hydrate(rows);
}

/** All tasks (any status) where a person is an assignee OR the creator (admin view). */
export async function listTasksForPerson(userId: number): Promise<Task[]> {
  // Nur Aufgaben, die der Person zugewiesen sind (nicht die von ihr erstellten).
  const [rows] = await getPool().query<TaskRow[]>(
    `${SELECT} WHERE EXISTS (
        SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?
      ) ${ORDER}`,
    [userId]
  );
  return hydrate(rows);
}

/** All not-yet-completed tasks (administrator overview). */
export async function listAllOpenTasks(): Promise<Task[]> {
  const [rows] = await getPool().query<TaskRow[]>(
    `${SELECT} WHERE t.status <> 'erledigt' ${ORDER}`
  );
  return hydrate(rows);
}

/** All overdue tasks across the company (administrator overview). */
export async function listAllOverdueTasks(): Promise<Task[]> {
  const [rows] = await getPool().query<TaskRow[]>(
    `${SELECT} WHERE t.status <> 'erledigt' AND t.due_date IS NOT NULL AND t.due_date < CURDATE() ${ORDER}`
  );
  return hydrate(rows);
}

export async function getTaskById(id: number): Promise<Task | null> {
  const [rows] = await getPool().query<TaskRow[]>(`${SELECT} WHERE t.id = ? LIMIT 1`, [id]);
  const tasks = await hydrate(rows);
  return tasks[0] ?? null;
}

export async function createTask(input: {
  title: string;
  description: string | null;
  createdBy: number;
  assignedTo: number[];
  dueDate: string | null;
  projectId?: number | null;
  projectRelativeId?: number | null;
  projectName?: string | null;
  actionButtons?: string[] | null;
}): Promise<void> {
  const pool = getPool();
  const buttons = (input.actionButtons ?? []).map((s) => String(s).trim()).filter(Boolean);
  const [res] = await pool.query(
    `INSERT INTO tasks (title, description, created_by, status, due_date, project_id, project_relative_id, project_name, action_buttons)
     VALUES (?, ?, ?, 'offen', ?, ?, ?, ?, ?)`,
    [
      input.title,
      input.description,
      input.createdBy,
      input.dueDate,
      input.projectId ?? null,
      input.projectRelativeId ?? null,
      input.projectName ?? null,
      buttons.length > 0 ? JSON.stringify(buttons) : null,
    ]
  );
  const taskId = (res as { insertId: number }).insertId;
  const assignees = [...new Set(input.assignedTo)].filter((id) => Number.isFinite(id) && id > 0);
  if (assignees.length > 0) {
    await pool.query("INSERT IGNORE INTO task_assignees (task_id, user_id) VALUES ?", [
      assignees.map((uid) => [taskId, uid]),
    ]);
  }
  await addHistory(taskId, input.createdBy, "created", "Aufgabe erstellt");

  // Ins HERO-Projektlogbuch schreiben (nur wenn ein Projekt zugeordnet ist).
  if (input.projectId) {
    try {
      const ids = [input.createdBy, ...assignees];
      const [urows] = await pool.query<RowDataPacket[]>(
        "SELECT id, COALESCE(NULLIF(display_name, ''), username) AS name FROM users WHERE id IN (?)",
        [ids.length > 0 ? ids : [0]]
      );
      const nameById = new Map<number, string>();
      for (const u of urows) nameById.set(u.id as number, u.name as string);
      const assigneeNames = assignees.map((a) => nameById.get(a) ?? `#${a}`).join(", ");
      const lines = [`Aufgabe erstellt: ${input.title}`];
      if (input.description) lines.push(input.description);
      if (input.dueDate) lines.push(`Fällig: ${input.dueDate}`);
      if (assigneeNames) lines.push(`Zugewiesen an: ${assigneeNames}`);
      const creator = nameById.get(input.createdBy);
      if (creator) lines.push(`Erstellt von: ${creator}`);
      await writeProjectLogbook(input.projectId, lines.join("\n"));
    } catch {
      // Logbuch ist optional – Fehler hier darf die Aufgabe nicht scheitern lassen.
    }
  }
}

/** Marker embedded in a price-request task's description to tie it to an article. */
function ekRequestMarker(heroArticleId: number): string {
  return `[EKREQ:${heroArticleId}]`;
}

/**
 * Creates a task asking admins to enter the EK price for an article — but only
 * if no open request for that article exists yet (avoids duplicates).
 */
export async function createEkPriceRequest(
  heroArticleId: number,
  articleName: string,
  createdBy: number,
  adminIds: number[]
): Promise<void> {
  const marker = ekRequestMarker(heroArticleId);
  const [existing] = await getPool().query<RowDataPacket[]>(
    "SELECT id FROM tasks WHERE status <> 'erledigt' AND description LIKE ? LIMIT 1",
    [`%${marker}%`]
  );
  if (existing.length > 0) return;
  await createTask({
    title: `EK-Preis hinterlegen: ${articleName}`,
    description:
      `Für den Artikel „${articleName}" wurde beim Lagerausgang kein EK-Preis gefunden. ` +
      `Bitte im Lager den Einkaufspreis hinterlegen, damit der Warenwert nachgetragen wird. ${marker}`,
    createdBy,
    assignedTo: adminIds,
    dueDate: null,
  });
}

/** Completes open EK-price requests for an article once a price was entered. */
export async function completeEkPriceRequests(
  heroArticleId: number,
  byUserId: number
): Promise<void> {
  const marker = ekRequestMarker(heroArticleId);
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT id FROM tasks WHERE status <> 'erledigt' AND description LIKE ?",
    [`%${marker}%`]
  );
  for (const r of rows) {
    await setTaskStatus(r.id as number, "erledigt", byUserId);
  }
}

/** Marker embedded in a review task's description to tie it to a HERO receipt. */
function reviewMarker(heroReceiptId: string): string {
  return `[RECHNPRUEF:${heroReceiptId}]`;
}

/** Creates a task asking a reviewer to check a HERO receipt (no duplicates). */
export async function createReviewTask(
  heroReceiptId: string,
  label: string,
  createdBy: number,
  assignedTo: number,
  note?: string | null
): Promise<void> {
  const marker = reviewMarker(heroReceiptId);
  const [existing] = await getPool().query<RowDataPacket[]>(
    "SELECT id FROM tasks WHERE status <> 'erledigt' AND description LIKE ? LIMIT 1",
    [`%${marker}%`]
  );
  if (existing.length > 0) return;
  const noteLine = note ? `\n\nNotiz: ${note}` : "";
  await createTask({
    title: `Rechnung prüfen: ${label}`,
    description: `Bitte die Eingangsrechnung prüfen und freigeben/ablehnen.${noteLine} ${marker}`,
    createdBy,
    assignedTo: [assignedTo],
    dueDate: null,
  });
}

/** Completes open review tasks for a receipt once it was decided. */
export async function completeReviewTasks(heroReceiptId: string, byUserId: number): Promise<void> {
  const marker = reviewMarker(heroReceiptId);
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT id FROM tasks WHERE status <> 'erledigt' AND description LIKE ?",
    [`%${marker}%`]
  );
  for (const r of rows) await setTaskStatus(r.id as number, "erledigt", byUserId);
}

/** Updates a task's status and logs it (with an optional remark). */
export async function setTaskStatus(
  id: number,
  status: TaskStatus,
  byUserId: number,
  note: string | null = null
): Promise<void> {
  await getPool().query("UPDATE tasks SET status = ? WHERE id = ?", [status, id]);
  const detail = `Status: ${taskStatusLabel(status)}${note ? ` – ${note}` : ""}`;
  await addHistory(id, byUserId, "status", detail);
}

/** Adds a free-text note (comment) to a task and logs it in the history. */
export async function addTaskNote(id: number, byUserId: number, note: string): Promise<void> {
  await addHistory(id, byUserId, "note", note);

  // Notiz zusätzlich ins HERO-Projektlogbuch schreiben (wenn Projekt zugeordnet).
  try {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT t.project_id, t.title, COALESCE(NULLIF(u.display_name, ''), u.username) AS by_name
       FROM tasks t LEFT JOIN users u ON u.id = ? WHERE t.id = ? LIMIT 1`,
      [byUserId, id]
    );
    const projectId = rows[0]?.project_id as number | null;
    if (projectId) {
      const title = (rows[0]?.title as string) ?? "";
      const by = (rows[0]?.by_name as string) ?? "";
      const text = `Notiz zur Aufgabe „${title}": ${note}${by ? `\n(${by})` : ""}`;
      await writeProjectLogbook(projectId, text);
    }
  } catch {
    // optional
  }
}

/** Forwards a task to another person (adds them as assignee) and logs it. */
export async function forwardTask(
  id: number,
  byUserId: number,
  toUserId: number
): Promise<void> {
  const pool = getPool();
  await pool.query("INSERT IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)", [
    id,
    toUserId,
  ]);
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COALESCE(NULLIF(display_name, ''), username) AS name FROM users WHERE id = ? LIMIT 1",
    [toUserId]
  );
  const name = (rows[0]?.name as string) ?? `#${toUserId}`;
  await addHistory(id, byUserId, "forwarded", `Weitergeleitet an ${name}`);
}
