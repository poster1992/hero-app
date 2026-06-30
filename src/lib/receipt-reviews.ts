import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

export type ReviewStatus = "offen" | "freigegeben" | "abgelehnt";

export interface ReviewHistoryEntry {
  id: number;
  action: string;
  actionLabel: string;
  detail: string | null;
  byName: string | null;
  at: string | null;
}

export interface ReceiptReview {
  heroReceiptId: string;
  status: ReviewStatus;
  assignedToId: number | null;
  assignedToName: string | null;
  reviewedById: number | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  note: string | null;
  docUrl: string | null;
  number: string | null;
  supplier: string | null;
  gross: number | null;
  projectMatchId: number | null;
  projectRelativeId: number | null;
  projectName: string | null;
  history: ReviewHistoryEntry[];
}

interface HistoryRow extends RowDataPacket {
  id: number;
  hero_receipt_id: string;
  action: string;
  detail: string | null;
  by_name: string | null;
  created_at: string | null;
}

function historyActionLabel(action: string): string {
  switch (action) {
    case "assigned":
      return "Zugewiesen";
    case "freigegeben":
      return "Freigegeben";
    case "abgelehnt":
      return "Abgelehnt";
    default:
      return action;
  }
}

interface ReviewRow extends RowDataPacket {
  hero_receipt_id: string;
  status: string;
  assigned_to: number | null;
  assigned_to_name: string | null;
  reviewed_by: number | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  note: string | null;
  doc_url: string | null;
  receipt_number: string | null;
  supplier: string | null;
  gross: string | number | null;
  project_match_id: number | null;
  project_relative_id: number | null;
  project_name: string | null;
}

export function reviewStatusLabel(s: ReviewStatus): string {
  return s === "freigegeben" ? "Freigegeben" : s === "abgelehnt" ? "Abgelehnt" : "Offen";
}

function mapRow(r: ReviewRow): ReceiptReview {
  return {
    heroReceiptId: r.hero_receipt_id,
    status: (r.status as ReviewStatus) ?? "offen",
    assignedToId: r.assigned_to,
    assignedToName: r.assigned_to_name,
    reviewedById: r.reviewed_by,
    reviewedByName: r.reviewed_by_name,
    reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
    note: r.note,
    docUrl: r.doc_url,
    number: r.receipt_number,
    supplier: r.supplier,
    gross: r.gross == null ? null : Number(r.gross),
    projectMatchId: r.project_match_id,
    projectRelativeId: r.project_relative_id,
    projectName: r.project_name,
    history: [],
  };
}

function mapHistory(r: HistoryRow): ReviewHistoryEntry {
  return {
    id: r.id,
    action: r.action,
    actionLabel: historyActionLabel(r.action),
    detail: r.detail,
    byName: r.by_name,
    at: r.created_at ? String(r.created_at) : null,
  };
}

const HISTORY_SELECT = `
  SELECT h.id, h.hero_receipt_id, h.action, h.detail, h.created_at,
         COALESCE(NULLIF(u.display_name, ''), u.username) AS by_name
  FROM receipt_review_history h
  LEFT JOIN users u ON u.id = h.user_id
`;

/** Appends a history entry for a receipt review. */
export async function addReviewHistory(
  heroReceiptId: string,
  userId: number | null,
  action: string,
  detail: string | null
): Promise<void> {
  await getPool().query(
    "INSERT INTO receipt_review_history (hero_receipt_id, user_id, action, detail) VALUES (?, ?, ?, ?)",
    [heroReceiptId, userId, action, detail]
  );
}

const SELECT = `
  SELECT rr.hero_receipt_id, rr.status, rr.assigned_to, rr.reviewed_by, rr.reviewed_at, rr.note,
         rr.doc_url, rr.receipt_number, rr.supplier, rr.gross,
         rr.project_match_id, rr.project_relative_id, rr.project_name,
         COALESCE(NULLIF(au.display_name, ''), au.username) AS assigned_to_name,
         COALESCE(NULLIF(ru.display_name, ''), ru.username) AS reviewed_by_name
  FROM receipt_reviews rr
  LEFT JOIN users au ON au.id = rr.assigned_to
  LEFT JOIN users ru ON ru.id = rr.reviewed_by
`;

/** All reviews keyed by HERO receipt id, incl. history. */
export async function listReceiptReviews(): Promise<Map<string, ReceiptReview>> {
  const pool = getPool();
  const [rows] = await pool.query<ReviewRow[]>(SELECT);
  const map = new Map<string, ReceiptReview>();
  for (const r of rows) map.set(r.hero_receipt_id, mapRow(r));
  if (map.size > 0) {
    const [hist] = await pool.query<HistoryRow[]>(`${HISTORY_SELECT} ORDER BY h.created_at, h.id`);
    for (const h of hist) {
      map.get(h.hero_receipt_id)?.history.push(mapHistory(h));
    }
  }
  return map;
}

/** Single review by HERO receipt id (incl. history), or null. */
export async function getReceiptReview(heroReceiptId: string): Promise<ReceiptReview | null> {
  const pool = getPool();
  const [rows] = await pool.query<ReviewRow[]>(`${SELECT} WHERE rr.hero_receipt_id = ? LIMIT 1`, [
    heroReceiptId,
  ]);
  if (!rows[0]) return null;
  const review = mapRow(rows[0]);
  const [hist] = await pool.query<HistoryRow[]>(
    `${HISTORY_SELECT} WHERE h.hero_receipt_id = ? ORDER BY h.created_at, h.id`,
    [heroReceiptId]
  );
  review.history = hist.map(mapHistory);
  return review;
}

interface ReceiptSnapshot {
  number: string | null;
  supplier: string | null;
  gross: number | null;
  docUrl?: string | null;
  projectMatchId?: number | null;
  projectRelativeId?: number | null;
  projectName?: string | null;
}

/** Assigns a reviewer to a receipt (status stays "offen"). */
export async function assignReviewer(
  heroReceiptId: string,
  userId: number,
  snap: ReceiptSnapshot
): Promise<void> {
  await getPool().query(
    `INSERT INTO receipt_reviews (hero_receipt_id, status, assigned_to, receipt_number, supplier, gross, doc_url,
       project_match_id, project_relative_id, project_name)
     VALUES (?, 'offen', ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE assigned_to = VALUES(assigned_to),
       receipt_number = VALUES(receipt_number), supplier = VALUES(supplier), gross = VALUES(gross),
       doc_url = VALUES(doc_url),
       project_match_id = COALESCE(VALUES(project_match_id), project_match_id),
       project_relative_id = COALESCE(VALUES(project_relative_id), project_relative_id),
       project_name = COALESCE(VALUES(project_name), project_name)`,
    [
      heroReceiptId,
      userId,
      snap.number,
      snap.supplier,
      snap.gross,
      snap.docUrl ?? null,
      snap.projectMatchId ?? null,
      snap.projectRelativeId ?? null,
      snap.projectName ?? null,
    ]
  );
}

/** Records a review decision (freigegeben/abgelehnt) with reviewer + note. */
export async function setReviewDecision(
  heroReceiptId: string,
  status: ReviewStatus,
  byUserId: number,
  note: string | null,
  snap: ReceiptSnapshot
): Promise<void> {
  await getPool().query(
    `INSERT INTO receipt_reviews
       (hero_receipt_id, status, reviewed_by, reviewed_at, note, receipt_number, supplier, gross)
     VALUES (?, ?, ?, NOW(), ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE status = VALUES(status), reviewed_by = VALUES(reviewed_by),
       reviewed_at = VALUES(reviewed_at), note = VALUES(note),
       receipt_number = VALUES(receipt_number), supplier = VALUES(supplier), gross = VALUES(gross)`,
    [heroReceiptId, status, byUserId, note, snap.number, snap.supplier, snap.gross]
  );
}
