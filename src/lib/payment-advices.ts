import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

/**
 * Zahlungsavise (Remittance Advice) vom Lieferanten: reine Speicherung je Monat +
 * späterer Export (z. B. im Steuerberater-PDF-ZIP). KEINE Buchung, keine Beträge,
 * fließt in keine Summen/SEPA ein.
 */

const BELEGE_DIR = process.env.BELEGE_DIR || path.join(process.cwd(), "data", "belege");
const AVIS_DIR = path.join(BELEGE_DIR, "avise");

export interface PaymentAdvice {
  id: number;
  year: number;
  month: number;
  supplier: string | null;
  note: string | null;
  fileName: string | null;
  mime: string | null;
  hasFile: boolean;
  created: string | null;
}

interface AdviceRow extends RowDataPacket {
  id: number;
  year: number;
  month: number;
  supplier: string | null;
  note: string | null;
  file_name: string | null;
  stored_name: string | null;
  mime: string | null;
  created: string | null;
}

function mapRow(r: AdviceRow): PaymentAdvice {
  return {
    id: r.id,
    year: r.year,
    month: r.month,
    supplier: r.supplier,
    note: r.note,
    fileName: r.file_name,
    mime: r.mime,
    hasFile: !!r.stored_name,
    created: r.created ? String(r.created) : null,
  };
}

/** Zahlungsavise eines Monats (neueste zuerst). */
export async function listPaymentAdvices(year: number, month: number): Promise<PaymentAdvice[]> {
  const [rows] = await getPool().query<AdviceRow[]>(
    `SELECT id, year, month, supplier, note, file_name, stored_name, mime, created
       FROM payment_advices WHERE year = ? AND month = ?
       ORDER BY created DESC, id DESC`,
    [year, month]
  );
  return rows.map(mapRow);
}

/** Legt ein Zahlungsavis mit Datei an. */
export async function createPaymentAdvice(input: {
  year: number;
  month: number;
  supplier: string | null;
  note: string | null;
  file: { buffer: Buffer; originalName: string; mime: string };
  uploadedBy: number | null;
}): Promise<number> {
  await mkdir(AVIS_DIR, { recursive: true });
  const ext = path.extname(input.file.originalName) || "";
  const storedName = `${randomUUID()}${ext}`;
  await writeFile(path.join(AVIS_DIR, storedName), input.file.buffer);

  const [res] = await getPool().query(
    `INSERT INTO payment_advices (year, month, supplier, note, file_name, stored_name, mime, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.year,
      input.month,
      input.supplier,
      input.note,
      input.file.originalName,
      storedName,
      input.file.mime,
      input.uploadedBy,
    ]
  );
  return (res as { insertId: number }).insertId;
}

/** Lädt die gespeicherte Datei eines Avis (für Ansicht/Download/Export). */
export async function getPaymentAdviceFile(
  id: number
): Promise<{ data: Buffer; mime: string; name: string } | null> {
  const [rows] = await getPool().query<AdviceRow[]>(
    "SELECT file_name, stored_name, mime FROM payment_advices WHERE id = ? LIMIT 1",
    [id]
  );
  const row = rows[0];
  if (!row?.stored_name) return null;
  try {
    const data = await readFile(path.join(AVIS_DIR, row.stored_name));
    return { data, mime: row.mime ?? "application/octet-stream", name: row.file_name ?? "zahlungsavis" };
  } catch {
    return null;
  }
}

/** Löscht ein Avis samt Datei. */
export async function deletePaymentAdvice(id: number): Promise<void> {
  const pool = getPool();
  const [rows] = await pool.query<AdviceRow[]>(
    "SELECT stored_name FROM payment_advices WHERE id = ? LIMIT 1",
    [id]
  );
  const stored = rows[0]?.stored_name ?? null;
  await pool.query("DELETE FROM payment_advices WHERE id = ?", [id]);
  if (stored) {
    try {
      await unlink(path.join(AVIS_DIR, stored));
    } catch {
      // Datei evtl. schon weg – ignorieren.
    }
  }
}
