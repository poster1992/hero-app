import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { getPool } from "./db";

// Eigenständiger, abgekapselter Ablageort – unabhängig von den HERO-Belegen.
// Liegt im selben persistenten Volume wie die übrigen Uploads (eigener Unterordner).
const BELEGE_DIR = process.env.BELEGE_DIR || path.join(process.cwd(), "data", "belege");
const BAUSTELLEN_BELEGE_DIR =
  process.env.BAUSTELLEN_BELEGE_DIR || path.join(BELEGE_DIR, "baustellen-belege");

export interface BaustellenBeleg {
  id: number;
  fileName: string;
  mime: string | null;
  size: number | null;
  uploadedByName: string | null;
  uploadedAt: string | null;
  ocrStatus: string | null;
  hasOcr: boolean;
  supplier: string | null;
  amount: number | null;
  belegDate: string | null;
  isPaid: boolean;
}

interface Row extends RowDataPacket {
  id: number;
  file_name: string;
  mime: string | null;
  size: number | null;
  uploaded_by_name: string | null;
  uploaded_at: string | null;
  ocr_status: string | null;
  has_ocr: number;
  ocr_supplier: string | null;
  ocr_amount: string | number | null;
  ocr_date: string | null;
  is_paid: number;
}

/**
 * Belege eines Baustellen-Ordners (neueste zuerst). Optionaler Suchbegriff `q`
 * durchsucht **nur diesen Ordner** in Dateiname UND OCR-Text (projektbezogen).
 */
export async function listBaustellenBelege(
  baustelleId: number,
  q?: string
): Promise<BaustellenBeleg[]> {
  const search = (q ?? "").trim();
  const params: unknown[] = [baustelleId];
  let where = "b.baustelle_id = ?";
  if (search) {
    where += " AND (b.file_name LIKE ? OR b.ocr_text LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }
  const [rows] = await getPool().query<Row[]>(
    `SELECT b.id, b.file_name, b.mime, b.size, b.uploaded_at, b.ocr_status,
            (b.ocr_text IS NOT NULL AND b.ocr_text <> '') AS has_ocr,
            b.ocr_supplier, b.ocr_amount, b.ocr_date, b.is_paid,
            COALESCE(NULLIF(u.display_name, ''), u.username) AS uploaded_by_name
       FROM baustellen_belege b
       LEFT JOIN users u ON u.id = b.uploaded_by
      WHERE ${where}
      ORDER BY b.id DESC`,
    params
  );
  return rows.map((r) => ({
    id: r.id,
    fileName: r.file_name,
    mime: r.mime,
    size: r.size == null ? null : Number(r.size),
    uploadedByName: r.uploaded_by_name,
    uploadedAt: r.uploaded_at ? String(r.uploaded_at) : null,
    ocrStatus: r.ocr_status,
    hasOcr: r.has_ocr === 1,
    supplier: r.ocr_supplier,
    amount: r.ocr_amount == null ? null : Number(r.ocr_amount),
    belegDate: r.ocr_date ? String(r.ocr_date).slice(0, 10) : null,
    isPaid: r.is_paid === 1,
  }));
}

export interface BaustellenBelegeStats {
  count: number;
  total: number;
  paidTotal: number;
  openTotal: number;
  bySupplier: { supplier: string; amount: number; count: number }[];
}

/** Aggregierte Kennzahlen über ALLE Belege eines Ordners (unabhängig von der Suche). */
export async function getBaustellenBelegeStats(baustelleId: number): Promise<BaustellenBelegeStats> {
  const pool = getPool();
  const [totals] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(ocr_amount), 0) AS total,
            COALESCE(SUM(CASE WHEN is_paid = 1 THEN ocr_amount ELSE 0 END), 0) AS paid,
            COALESCE(SUM(CASE WHEN is_paid = 0 THEN ocr_amount ELSE 0 END), 0) AS open_sum
       FROM baustellen_belege WHERE baustelle_id = ?`,
    [baustelleId]
  );
  const [sup] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(ocr_supplier, ''), 'Unbekannt') AS supplier,
            COALESCE(SUM(ocr_amount), 0) AS amount, COUNT(*) AS count
       FROM baustellen_belege WHERE baustelle_id = ?
      GROUP BY COALESCE(NULLIF(ocr_supplier, ''), 'Unbekannt')
      ORDER BY amount DESC`,
    [baustelleId]
  );
  const t = totals[0] as { count: number; total: string | number; paid: string | number; open_sum: string | number };
  return {
    count: Number(t.count),
    total: Number(t.total),
    paidTotal: Number(t.paid),
    openTotal: Number(t.open_sum),
    bySupplier: (sup as { supplier: string; amount: string | number; count: number }[]).map((r) => ({
      supplier: r.supplier,
      amount: Number(r.amount),
      count: Number(r.count),
    })),
  };
}

/** Setzt den Bezahlstatus eines Belegs. */
export async function setBaustellenBelegPaid(id: number, paid: boolean): Promise<void> {
  await getPool().query("UPDATE baustellen_belege SET is_paid = ? WHERE id = ?", [paid ? 1 : 0, id]);
}

/** Lädt einen Beleg zu einem Baustellen-Ordner hoch. Gibt die neue Beleg-ID zurück. */
export async function addBaustellenBeleg(
  baustelleId: number,
  file: { buffer: Buffer; originalName: string; mime: string },
  uploadedBy: number | null
): Promise<number> {
  await mkdir(BAUSTELLEN_BELEGE_DIR, { recursive: true });
  const ext = path.extname(file.originalName) || "";
  const storedName = `${randomUUID()}${ext}`;
  await writeFile(path.join(BAUSTELLEN_BELEGE_DIR, storedName), file.buffer);
  const [res] = await getPool().query<ResultSetHeader>(
    `INSERT INTO baustellen_belege (baustelle_id, file_name, stored_name, mime, size, uploaded_by, ocr_status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [baustelleId, file.originalName.slice(0, 255), storedName, file.mime, file.buffer.length, uploadedBy]
  );
  return res.insertId;
}

/** Rohdaten eines Belegs (für die OCR) inkl. Base64. */
export async function getBaustellenBelegRaw(
  id: number
): Promise<{ data: string; mime: string } | null> {
  const [rows] = await getPool().query<(Row & { stored_name: string })[]>(
    "SELECT stored_name, mime FROM baustellen_belege WHERE id = ? LIMIT 1",
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  try {
    const buf = await readFile(path.join(BAUSTELLEN_BELEGE_DIR, row.stored_name));
    return { data: buf.toString("base64"), mime: row.mime || "application/octet-stream" };
  } catch {
    return null;
  }
}

/** Speichert das OCR-Ergebnis eines Belegs (getrennt von HERO/Belege-OCR). */
export async function setBaustellenBelegOcr(
  id: number,
  status: "done" | "error",
  data: { supplier: string | null; amount: number | null; date: string | null; text: string | null }
): Promise<void> {
  await getPool().query(
    `UPDATE baustellen_belege
        SET ocr_status = ?, ocr_text = ?, ocr_supplier = ?, ocr_amount = ?, ocr_date = ?
      WHERE id = ?`,
    [status, data.text, data.supplier, data.amount, data.date, id]
  );
}

/** Liefert eine Beleg-Datei zum Anzeigen/Download. */
export async function getBaustellenBelegFile(
  id: number
): Promise<{ data: Buffer; mime: string; name: string } | null> {
  const [rows] = await getPool().query<(Row & { stored_name: string })[]>(
    "SELECT file_name, stored_name, mime FROM baustellen_belege WHERE id = ? LIMIT 1",
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  try {
    const data = await readFile(path.join(BAUSTELLEN_BELEGE_DIR, row.stored_name));
    return { data, mime: row.mime || "application/octet-stream", name: row.file_name };
  } catch {
    return null;
  }
}

/** Entfernt einen Beleg (DB-Eintrag + Datei). */
export async function deleteBaustellenBeleg(id: number): Promise<void> {
  const pool = getPool();
  const [rows] = await pool.query<(Row & { stored_name: string })[]>(
    "SELECT stored_name FROM baustellen_belege WHERE id = ? LIMIT 1",
    [id]
  );
  const stored = rows[0]?.stored_name ?? null;
  await pool.query("DELETE FROM baustellen_belege WHERE id = ?", [id]);
  if (stored) {
    try {
      await unlink(path.join(BAUSTELLEN_BELEGE_DIR, stored));
    } catch {
      // Datei evtl. schon weg – ignorieren.
    }
  }
}
