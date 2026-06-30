import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

export interface TaskNotification {
  id: number;
  taskId: number | null;
  kind: string;
  message: string;
  byName: string | null;
  createdAt: string | null;
}

interface NotifRow extends RowDataPacket {
  id: number;
  task_id: number | null;
  kind: string;
  message: string;
  by_name: string | null;
  created_at: string | null;
}

/** Legt eine In-App-Meldung für einen Benutzer an. */
export async function createTaskNotification(input: {
  userId: number;
  taskId: number | null;
  kind: "assigned" | "feedback";
  message: string;
  byName: string | null;
}): Promise<void> {
  if (!Number.isFinite(input.userId) || input.userId <= 0) return;
  await getPool().query(
    "INSERT INTO task_notifications (user_id, task_id, kind, message, by_name) VALUES (?, ?, ?, ?, ?)",
    [input.userId, input.taskId, input.kind, input.message.slice(0, 500), input.byName?.slice(0, 160) ?? null]
  );
}

/** Noch nicht bestätigte Meldungen eines Benutzers (neueste zuerst). */
export async function listUnacknowledged(userId: number): Promise<TaskNotification[]> {
  const [rows] = await getPool().query<NotifRow[]>(
    `SELECT id, task_id, kind, message, by_name, created_at
     FROM task_notifications
     WHERE user_id = ? AND acknowledged_at IS NULL
     ORDER BY created_at DESC, id DESC`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    kind: r.kind,
    message: r.message,
    byName: r.by_name,
    createdAt: r.created_at ? String(r.created_at) : null,
  }));
}

/** Anzahl unbestätigter Meldungen. */
export async function countUnacknowledged(userId: number): Promise<number> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM task_notifications WHERE user_id = ? AND acknowledged_at IS NULL",
    [userId]
  );
  return Number((rows[0] as { n: number })?.n ?? 0);
}

/** Bestätigt eine Meldung („zur Kenntnis genommen"). */
export async function acknowledgeNotification(id: number, userId: number): Promise<void> {
  await getPool().query(
    "UPDATE task_notifications SET acknowledged_at = NOW() WHERE id = ? AND user_id = ? AND acknowledged_at IS NULL",
    [id, userId]
  );
}

/** Bestätigt alle Meldungen eines Benutzers. */
export async function acknowledgeAllNotifications(userId: number): Promise<void> {
  await getPool().query(
    "UPDATE task_notifications SET acknowledged_at = NOW() WHERE user_id = ? AND acknowledged_at IS NULL",
    [userId]
  );
}
