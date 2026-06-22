import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

export interface ChecklistItem {
  id: number;
  label: string;
  done: boolean;
  doneAt: string | null;
}

interface ChecklistRow extends RowDataPacket {
  id: number;
  label: string;
  done: number | null;
  done_at: string | null;
}

/** Active checklist items with their done-state for the given month. */
export async function listChecklist(year: number, month: number): Promise<ChecklistItem[]> {
  const [rows] = await getPool().query<ChecklistRow[]>(
    `SELECT i.id, i.label, s.done, s.done_at
       FROM belege_checklist_items i
       LEFT JOIN belege_checklist_status s
         ON s.item_id = i.id AND s.year = ? AND s.month = ?
      WHERE i.active = 1
      ORDER BY i.sort_order, i.id`,
    [year, month]
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    done: r.done === 1,
    doneAt: r.done_at ? String(r.done_at).slice(0, 10) : null,
  }));
}

/** Adds a new recurring checklist item, appended to the end. */
export async function addChecklistItem(label: string): Promise<void> {
  await getPool().query(
    `INSERT INTO belege_checklist_items (label, sort_order)
     VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM belege_checklist_items i))`,
    [label]
  );
}

/** Soft-deletes a checklist item (keeps historical done-states). */
export async function removeChecklistItem(id: number): Promise<void> {
  await getPool().query("UPDATE belege_checklist_items SET active = 0 WHERE id = ?", [id]);
}

/** Sets/clears the done-state of an item for a specific month (upsert). */
export async function setChecklistDone(
  itemId: number,
  year: number,
  month: number,
  done: boolean
): Promise<void> {
  await getPool().query(
    `INSERT INTO belege_checklist_status (item_id, year, month, done, done_at)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE done = VALUES(done), done_at = VALUES(done_at)`,
    [itemId, year, month, done ? 1 : 0, done ? new Date() : null]
  );
}
