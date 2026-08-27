import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

/**
 * Persönlicher Notizblock je Benutzer (privat). Eine freie Textfläche pro Nutzer.
 */

let tableReady = false;
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await getPool()
    .query(
      `CREATE TABLE IF NOT EXISTS user_notes (
         user_id INT PRIMARY KEY,
         content MEDIUMTEXT NULL,
         updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    )
    .catch(() => {});
  tableReady = true;
}

interface NoteRow extends RowDataPacket {
  content: string | null;
  updated: string | null;
}

export interface UserNote {
  content: string;
  updated: string | null;
}

/** Liest den Notizblock eines Benutzers (leer, wenn noch keiner existiert). */
export async function getUserNote(userId: number): Promise<UserNote> {
  await ensureTable();
  const [rows] = await getPool().query<NoteRow[]>(
    "SELECT content, updated FROM user_notes WHERE user_id = ? LIMIT 1",
    [userId]
  );
  const r = rows[0];
  return { content: r?.content ?? "", updated: r?.updated ? String(r.updated) : null };
}

/** Speichert den Notizblock eines Benutzers (anlegen oder überschreiben). */
export async function saveUserNote(userId: number, content: string): Promise<void> {
  await ensureTable();
  await getPool().query(
    `INSERT INTO user_notes (user_id, content) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE content = VALUES(content)`,
    [userId, content.slice(0, 4_000_000)]
  );
}
