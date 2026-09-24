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

/**
 * Stellt die Spalte `format` sicher (self-healing). Unterscheidet reinen Text
 * (alte Notizen aus der Textarea-Version) von HTML (neuer Editor mit Fett/
 * Farben) – ohne diese Spalte müsste geraten werden, ob ein "<" im Text ein
 * echtes HTML-Tag oder nur ein getippertes Zeichen ist, was Notizen zerstören
 * kann (führte zu genau diesem Bug: Text wurde als HTML fehlinterpretiert).
 */
let formatColumnReady = false;
async function ensureFormatColumn(): Promise<void> {
  if (formatColumnReady) return;
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_notes' AND COLUMN_NAME = 'format'`
  );
  if ((rows[0]?.n ?? 0) === 0) {
    // Bestehende Zeilen sind alle reiner Text (vor dem neuen Editor entstanden).
    await pool
      .query("ALTER TABLE user_notes ADD COLUMN format VARCHAR(8) NOT NULL DEFAULT 'text'")
      .catch(() => {});
  }
  formatColumnReady = true;
}

interface NoteRow extends RowDataPacket {
  content: string | null;
  updated: string | null;
  format: string | null;
}

export interface UserNote {
  content: string;
  updated: string | null;
  /** "text" = alte Notiz (reiner Text, ohne <br>), "html" = mit dem Editor gespeichert. */
  format: "text" | "html";
}

/** Liest den Notizblock eines Benutzers (leer, wenn noch keiner existiert). */
export async function getUserNote(userId: number): Promise<UserNote> {
  await ensureTable();
  await ensureFormatColumn();
  const [rows] = await getPool().query<NoteRow[]>(
    "SELECT content, updated, format FROM user_notes WHERE user_id = ? LIMIT 1",
    [userId]
  );
  const r = rows[0];
  return {
    content: r?.content ?? "",
    updated: r?.updated ? String(r.updated) : null,
    format: r?.format === "html" ? "html" : "text",
  };
}

/** Speichert den Notizblock eines Benutzers (anlegen oder überschreiben). Immer als HTML (neuer Editor). */
export async function saveUserNote(userId: number, content: string): Promise<void> {
  await ensureTable();
  await ensureFormatColumn();
  await getPool().query(
    `INSERT INTO user_notes (user_id, content, format) VALUES (?, ?, 'html')
     ON DUPLICATE KEY UPDATE content = VALUES(content), format = 'html'`,
    [userId, content.slice(0, 4_000_000)]
  );
}
