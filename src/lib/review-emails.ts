import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

/** Anzahl versendeter Kundenzufriedenheitsumfragen (gesamt bzw. optional ab Jahr). */
export async function countReviewEmailsSent(year?: number): Promise<number> {
  const sql = year
    ? "SELECT COUNT(*) AS n FROM review_emails WHERE YEAR(sent_at) = ?"
    : "SELECT COUNT(*) AS n FROM review_emails";
  const [rows] = await getPool().query<RowDataPacket[]>(sql, year ? [year] : []);
  return Number((rows[0] as { n: number })?.n ?? 0);
}

/** Wurde für dieses Projekt/diesen Kunden bereits eine Bewertungsmail versendet? */
export async function wasReviewEmailSent(projectKey: string): Promise<boolean> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT 1 FROM review_emails WHERE project_key = ? LIMIT 1",
    [projectKey]
  );
  return rows.length > 0;
}

/** Vermerkt, dass die Bewertungsmail für dieses Projekt versendet wurde (idempotent). */
export async function markReviewEmailSent(input: {
  projectKey: string;
  email: string | null;
  taskId: number | null;
  sentBy: number | null;
}): Promise<void> {
  await getPool().query(
    "INSERT IGNORE INTO review_emails (project_key, customer_email, task_id, sent_by) VALUES (?, ?, ?, ?)",
    [input.projectKey.slice(0, 191), input.email, input.taskId, input.sentBy]
  );
}
