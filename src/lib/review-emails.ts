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

/**
 * Hat dieser KUNDE jemals schon eine Bewertungsmail erhalten? Prüft (unabhängig
 * vom Projekt) über die HERO-Kundennummer ODER die E-Mail-Adresse, damit auch
 * frühere, projektbezogene Versände (die nur die E-Mail gespeichert haben) greifen.
 */
export async function wasReviewEmailSentToCustomer(input: {
  customerId?: string | number | null;
  email?: string | null;
}): Promise<boolean> {
  const conds: string[] = [];
  const params: (string | number)[] = [];
  if (input.customerId != null && String(input.customerId).trim()) {
    conds.push("customer_id = ?");
    params.push(String(input.customerId).trim());
  }
  if (input.email && input.email.trim()) {
    conds.push("customer_email = ?");
    params.push(input.email.trim());
  }
  if (conds.length === 0) return false;
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT 1 FROM review_emails WHERE ${conds.join(" OR ")} LIMIT 1`,
    params
  );
  return rows.length > 0;
}

/** Vermerkt, dass die Bewertungsmail für dieses Projekt/diesen Kunden versendet wurde (idempotent). */
export async function markReviewEmailSent(input: {
  projectKey: string;
  email: string | null;
  taskId: number | null;
  sentBy: number | null;
  customerId?: string | number | null;
  customerName?: string | null;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO review_emails (project_key, customer_email, task_id, sent_by, customer_id, customer_name)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       customer_email = VALUES(customer_email),
       customer_id = COALESCE(VALUES(customer_id), customer_id),
       customer_name = COALESCE(VALUES(customer_name), customer_name)`,
    [
      input.projectKey.slice(0, 191),
      input.email,
      input.taskId,
      input.sentBy,
      input.customerId != null ? String(input.customerId).trim().slice(0, 64) || null : null,
      input.customerName ? input.customerName.slice(0, 191) : null,
    ]
  );
}

export interface ReviewSentInfo {
  sentAt: string;
  email: string | null;
}

/**
 * Nachschlagewerk „welcher Kunde hat schon eine Bewertungsmail erhalten".
 * Liefert zwei Maps (nach Kundennummer und nach E-Mail, kleingeschrieben) mit
 * dem jeweils jüngsten Versanddatum.
 */
export async function getReviewSentLookup(): Promise<{
  byCustomerId: Map<string, ReviewSentInfo>;
  byEmail: Map<string, ReviewSentInfo>;
}> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT customer_id, customer_email, sent_at FROM review_emails"
  );
  const byCustomerId = new Map<string, ReviewSentInfo>();
  const byEmail = new Map<string, ReviewSentInfo>();
  for (const r of rows as { customer_id: string | null; customer_email: string | null; sent_at: string | Date }[]) {
    const sentAt = r.sent_at instanceof Date ? r.sent_at.toISOString() : String(r.sent_at);
    const info: ReviewSentInfo = { sentAt, email: r.customer_email };
    const keep = (prev: ReviewSentInfo | undefined) => (!prev || sentAt > prev.sentAt ? info : prev);
    if (r.customer_id && String(r.customer_id).trim()) {
      const k = String(r.customer_id).trim();
      byCustomerId.set(k, keep(byCustomerId.get(k)));
    }
    if (r.customer_email && r.customer_email.trim()) {
      const k = r.customer_email.trim().toLowerCase();
      byEmail.set(k, keep(byEmail.get(k)));
    }
  }
  return { byCustomerId, byEmail };
}

export interface ReviewHistoryRow {
  email: string | null;
  customerName: string | null;
  sentAt: string;
  sentBy: number | null;
}

/** Historie der versendeten Bewertungsmails (neueste zuerst). */
export async function listReviewEmailHistory(limit = 500): Promise<ReviewHistoryRow[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT customer_email, customer_name, sent_at, sent_by FROM review_emails ORDER BY sent_at DESC LIMIT ?",
    [limit]
  );
  return (rows as { customer_email: string | null; customer_name: string | null; sent_at: string | Date; sent_by: number | null }[]).map(
    (r) => ({
      email: r.customer_email,
      customerName: r.customer_name,
      sentAt: r.sent_at instanceof Date ? r.sent_at.toISOString() : String(r.sent_at),
      sentBy: r.sent_by,
    })
  );
}
