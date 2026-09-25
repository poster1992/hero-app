import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";
import { sniffMime } from "./file-sniff";
import { MARKER_COLORS, type MarkerColor } from "./kontoauszug-colors";

/**
 * Kontoauszüge (privat, ein Bankkonto): PDF-Auszüge werden nicht mehr
 * ausgelesen/automatisch zugeordnet, sondern hinten an eine gemeinsame
 * Sammel-PDF angehängt. Dazu lassen sich Seiten mit einer durchsuchbaren
 * Notiz markieren, um sie später wiederzufinden.
 */

const KONTOAUSZUEGE_DIR = process.env.KONTOAUSZUEGE_DIR || path.join(process.cwd(), "data", "kontoauszuege");
const ARCHIVE_PATH = path.join(KONTOAUSZUEGE_DIR, "kontoauszuege.pdf");

let tableReady = false;
async function ensureTables(): Promise<void> {
  if (tableReady) return;
  const pool = getPool();
  await pool
    .query(
      `CREATE TABLE IF NOT EXISTS bank_statement_uploads (
         id INT AUTO_INCREMENT PRIMARY KEY,
         filename VARCHAR(255) NULL,
         page_start INT NOT NULL,
         page_count INT NOT NULL,
         added_by INT NULL,
         added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    )
    .catch(() => {});
  await pool
    .query(
      `CREATE TABLE IF NOT EXISTS bank_statement_markers (
         id INT AUTO_INCREMENT PRIMARY KEY,
         page INT NOT NULL,
         note VARCHAR(1000) NOT NULL,
         color VARCHAR(10) NOT NULL DEFAULT 'red',
         created_by INT NULL,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         INDEX idx_bsm_page (page)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    )
    .catch(() => {});
  await ensureMarkerColorColumn();
  tableReady = true;
}

/** Self-healing: `color`-Spalte nachrüsten, falls die Tabelle schon vor der Farbfunktion existierte. */
let colorColumnReady = false;
async function ensureMarkerColorColumn(): Promise<void> {
  if (colorColumnReady) return;
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bank_statement_markers' AND COLUMN_NAME = 'color'`
  );
  if ((rows[0]?.n ?? 0) === 0) {
    await pool.query("ALTER TABLE bank_statement_markers ADD COLUMN color VARCHAR(10) NOT NULL DEFAULT 'red'").catch(() => {});
  }
  colorColumnReady = true;
}

function normalizeColor(v: unknown): MarkerColor {
  return MARKER_COLORS.some((c) => c.key === v) ? (v as MarkerColor) : "red";
}

export interface StatementUpload {
  id: number;
  filename: string | null;
  pageStart: number;
  pageCount: number;
  addedByName: string | null;
  addedAt: string | null;
}

export interface StatementMarker {
  id: number;
  page: number;
  note: string;
  color: MarkerColor;
  createdByName: string | null;
  createdAt: string | null;
}

interface UploadRow extends RowDataPacket {
  id: number;
  filename: string | null;
  page_start: number;
  page_count: number;
  added_at: string | null;
  added_by_name: string | null;
}

function mapUploadRow(r: UploadRow): StatementUpload {
  return {
    id: r.id,
    filename: r.filename,
    pageStart: r.page_start,
    pageCount: r.page_count,
    addedByName: r.added_by_name,
    addedAt: r.added_at ? String(r.added_at) : null,
  };
}

/** Liest die aktuelle Sammel-Datei (oder null, wenn noch keine existiert). */
export async function getStatementFile(): Promise<Buffer | null> {
  try {
    return await readFile(ARCHIVE_PATH);
  } catch {
    return null;
  }
}

/** Gesamtzahl Seiten der Sammel-Datei (aus der Upload-Historie, kein erneutes PDF-Parsen nötig). */
export async function getStatementPageCount(): Promise<number> {
  await ensureTables();
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT page_start + page_count - 1 AS total FROM bank_statement_uploads ORDER BY id DESC LIMIT 1`
  );
  return Number(rows[0]?.total ?? 0);
}

/** Hängt eine neue PDF-Datei hinten an die Sammel-Datei an. */
export async function appendStatementPdf(input: {
  buffer: Buffer;
  originalName: string;
  userId: number | null;
}): Promise<{ pageStart: number; pageCount: number }> {
  await ensureTables();
  if (sniffMime(input.buffer, "") !== "application/pdf") {
    throw new Error("Nur PDF-Dateien können angehängt werden.");
  }
  await mkdir(KONTOAUSZUEGE_DIR, { recursive: true });

  let target: PDFDocument;
  let pageStart: number;
  const existing = await getStatementFile();
  try {
    if (existing) {
      target = await PDFDocument.load(existing, { ignoreEncryption: true });
      pageStart = target.getPageCount() + 1;
    } else {
      target = await PDFDocument.create();
      pageStart = 1;
    }
    const incoming = await PDFDocument.load(input.buffer, { ignoreEncryption: true });
    const copied = await target.copyPages(incoming, incoming.getPageIndices());
    for (const page of copied) target.addPage(page);
    const pageCount = copied.length;
    await writeFile(ARCHIVE_PATH, await target.save());

    await getPool().query(
      `INSERT INTO bank_statement_uploads (filename, page_start, page_count, added_by) VALUES (?, ?, ?, ?)`,
      [input.originalName.slice(0, 255), pageStart, pageCount, input.userId]
    );
    return { pageStart, pageCount };
  } catch (e) {
    if (e instanceof Error && e.message.includes("angehängt")) throw e;
    throw new Error("PDF konnte nicht gelesen/angehängt werden (beschädigt oder kein gültiges PDF?).");
  }
}

/** Alle bisherigen Anhänge (neueste zuerst). */
export async function listStatementUploads(): Promise<StatementUpload[]> {
  await ensureTables();
  const [rows] = await getPool().query<UploadRow[]>(
    `SELECT u.id, u.filename, u.page_start, u.page_count, u.added_at,
            COALESCE(NULLIF(us.display_name, ''), us.username) AS added_by_name
     FROM bank_statement_uploads u
     LEFT JOIN users us ON us.id = u.added_by
     ORDER BY u.id DESC`
  );
  return rows.map(mapUploadRow);
}

/**
 * Macht den zuletzt angehängten Upload rückgängig (z. B. falsche Datei erwischt):
 * entfernt dessen Seiten vom Ende der Sammel-Datei und löscht Marker auf diesen
 * Seiten. Wirkt immer nur auf den letzten Eintrag (kein Entfernen mittendrin,
 * das würde alle nachfolgenden Seitennummern verschieben).
 */
export async function undoLastStatementUpload(): Promise<void> {
  await ensureTables();
  const pool = getPool();
  const [rows] = await pool.query<UploadRow[]>(
    `SELECT id, page_start, page_count FROM bank_statement_uploads ORDER BY id DESC LIMIT 1`
  );
  const last = rows[0];
  if (!last) return;

  const existing = await getStatementFile();
  if (existing) {
    const pdf = await PDFDocument.load(existing, { ignoreEncryption: true });
    const totalBefore = pdf.getPageCount();
    const removeFromIndex = last.page_start - 1; // 0-basiert
    // Von hinten nach vorn entfernen, sonst verschieben sich die Indizes.
    for (let i = totalBefore - 1; i >= removeFromIndex; i--) pdf.removePage(i);
    await writeFile(ARCHIVE_PATH, await pdf.save());
  }

  await pool.query(`DELETE FROM bank_statement_markers WHERE page >= ? AND page <= ?`, [
    last.page_start,
    last.page_start + last.page_count - 1,
  ]);
  await pool.query(`DELETE FROM bank_statement_uploads WHERE id = ?`, [last.id]);
}

interface MarkerRow extends RowDataPacket {
  id: number;
  page: number;
  note: string;
  color: string;
  created_at: string | null;
  created_by_name: string | null;
}

/** Alle Markierungen, nach Seite sortiert. */
export async function listStatementMarkers(): Promise<StatementMarker[]> {
  await ensureTables();
  const [rows] = await getPool().query<MarkerRow[]>(
    `SELECT m.id, m.page, m.note, m.color, m.created_at,
            COALESCE(NULLIF(u.display_name, ''), u.username) AS created_by_name
     FROM bank_statement_markers m
     LEFT JOIN users u ON u.id = m.created_by
     ORDER BY m.page ASC, m.id ASC`
  );
  return rows.map((r) => ({
    id: r.id,
    page: r.page,
    note: r.note,
    color: normalizeColor(r.color),
    createdByName: r.created_by_name,
    createdAt: r.created_at ? String(r.created_at) : null,
  }));
}

/** Legt eine Markierung (Seite + Notiz + Farbe) an. */
export async function addStatementMarker(input: {
  page: number;
  note: string;
  color?: string;
  userId: number | null;
}): Promise<void> {
  await ensureTables();
  const note = input.note.trim().slice(0, 1000);
  if (!note) return;
  const page = Math.max(1, Math.trunc(input.page));
  const color = normalizeColor(input.color);
  await getPool().query(
    `INSERT INTO bank_statement_markers (page, note, color, created_by) VALUES (?, ?, ?, ?)`,
    [page, note, color, input.userId]
  );
}

/** Löscht eine Markierung. */
export async function deleteStatementMarker(id: number): Promise<void> {
  await ensureTables();
  await getPool().query(`DELETE FROM bank_statement_markers WHERE id = ?`, [id]);
}
