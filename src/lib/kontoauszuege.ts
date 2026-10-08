import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, degrees, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";
import { sniffMime } from "./file-sniff";
import { MARKER_COLORS, type MarkerColor, markerColorRgb01 } from "./kontoauszug-colors";
import { getReceiptsInRange } from "./hero-api";
import { getCustomerName, effectiveReceiptStatus } from "./invoices";
import {
  listAllManualReceipts,
  searchManualOcrIds,
  setManualReceiptPaid,
  addManualReceiptPartialPayment,
  reduceManualReceiptPartialPayment,
} from "./manual-receipts";
import { searchOcrHeroIds } from "./receipt-ocr";
import { getPaymentOverrideMap, setPaymentOverride, clearPaymentOverride } from "./receipt-payment-status";

/**
 * Kontoauszüge (privat, ein Bankkonto): PDF-Auszüge werden nicht mehr
 * ausgelesen/automatisch zugeordnet, sondern hinten an eine gemeinsame
 * Sammel-PDF angehängt. Dazu lassen sich Seiten mit einer durchsuchbaren
 * Notiz markieren, um sie später wiederzufinden, oder direkt mit der Maus
 * im PDF markieren (Textmarker-Rechtecke).
 *
 * Zwei Dateien: `BASE_PATH` ist die reine, unmarkierte Sammlung der
 * hochgeladenen Auszüge (worauf Anhängen/Rückgängig arbeiten). `DISPLAY_PATH`
 * ist die ausgelieferte/angezeigte Datei = Basis + alle aktiven
 * Textmarker-Rechtecke (aus `bank_statement_highlights`) neu eingezeichnet.
 * So bleiben einzelne Markierungen jederzeit löschbar, statt unwiderruflich
 * in eine einzige Datei gebrannt zu sein: Löschen entfernt nur die Zeile und
 * baut die Anzeige-Datei aus der sauberen Basis neu auf.
 */

const KONTOAUSZUEGE_DIR = process.env.KONTOAUSZUEGE_DIR || path.join(process.cwd(), "data", "kontoauszuege");
const BASE_PATH = path.join(KONTOAUSZUEGE_DIR, "kontoauszuege.base.pdf");
const DISPLAY_PATH = path.join(KONTOAUSZUEGE_DIR, "kontoauszuege.pdf");

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
  await pool
    .query(
      `CREATE TABLE IF NOT EXISTS bank_statement_highlights (
         id INT AUTO_INCREMENT PRIMARY KEY,
         page INT NOT NULL,
         x DOUBLE NOT NULL,
         y DOUBLE NOT NULL,
         width DOUBLE NOT NULL,
         height DOUBLE NOT NULL,
         color VARCHAR(10) NOT NULL DEFAULT 'yellow',
         note VARCHAR(1000) NULL,
         marker_id INT NULL,
         created_by INT NULL,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         INDEX idx_bsh_page (page)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    )
    .catch(() => {});
  await pool
    .query(
      `CREATE TABLE IF NOT EXISTS bank_statement_stamps (
         id INT AUTO_INCREMENT PRIMARY KEY,
         page INT NOT NULL,
         created_by INT NULL,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         INDEX idx_bss_page (page)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    )
    .catch(() => {});
  await pool
    .query(
      `CREATE TABLE IF NOT EXISTS bank_statement_lines (
         id INT AUTO_INCREMENT PRIMARY KEY,
         page INT NOT NULL,
         x DOUBLE NOT NULL,
         y DOUBLE NOT NULL,
         width DOUBLE NOT NULL,
         height DOUBLE NOT NULL,
         amount DECIMAL(12,2) NOT NULL,
         date DATE NULL,
         paid_applied TINYINT NOT NULL DEFAULT 0,
         created_by INT NULL,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         INDEX idx_bsl_page (page)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    )
    .catch(() => {});
  await pool
    .query(
      `CREATE TABLE IF NOT EXISTS bank_statement_line_receipts (
         id INT AUTO_INCREMENT PRIMARY KEY,
         line_id INT NOT NULL,
         receipt_kind VARCHAR(10) NOT NULL,
         receipt_ref VARCHAR(64) NOT NULL,
         amount DECIMAL(12,2) NOT NULL,
         settlement_kind VARCHAR(10) NOT NULL DEFAULT 'full',
         supplier VARCHAR(255) NULL,
         invoice_number VARCHAR(100) NULL,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         INDEX idx_bslr_line (line_id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    )
    .catch(() => {});
  await ensureMarkerColorColumn();
  await ensureHighlightNoteColumn();
  await ensureHighlightMarkerIdColumn();
  await ensureLineDateColumns();
  await ensureLineReceiptSettlementColumn();
  tableReady = true;
}

/** Self-healing: `date`/`paid_applied`-Spalten auf bank_statement_lines nachrüsten. */
let lineDateColumnsReady = false;
async function ensureLineDateColumns(): Promise<void> {
  if (lineDateColumnsReady) return;
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bank_statement_lines' AND COLUMN_NAME IN ('date', 'paid_applied')`
  );
  const existing = new Set(rows.map((r) => String(r.COLUMN_NAME)));
  if (!existing.has("date")) {
    await pool.query("ALTER TABLE bank_statement_lines ADD COLUMN date DATE NULL").catch(() => {});
  }
  if (!existing.has("paid_applied")) {
    await pool.query("ALTER TABLE bank_statement_lines ADD COLUMN paid_applied TINYINT NOT NULL DEFAULT 0").catch(() => {});
  }
  lineDateColumnsReady = true;
}

/** Self-healing: `settlement_kind`-Spalte auf bank_statement_line_receipts nachrüsten. */
let lineReceiptSettlementColumnReady = false;
async function ensureLineReceiptSettlementColumn(): Promise<void> {
  if (lineReceiptSettlementColumnReady) return;
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bank_statement_line_receipts' AND COLUMN_NAME = 'settlement_kind'`
  );
  if ((rows[0]?.n ?? 0) === 0) {
    await pool
      .query("ALTER TABLE bank_statement_line_receipts ADD COLUMN settlement_kind VARCHAR(10) NOT NULL DEFAULT 'full'")
      .catch(() => {});
  }
  lineReceiptSettlementColumnReady = true;
}

/** Self-healing: `note`-Spalte nachrüsten, falls die Tabelle schon vor der Notiz-Funktion existierte. */
let highlightNoteColumnReady = false;
async function ensureHighlightNoteColumn(): Promise<void> {
  if (highlightNoteColumnReady) return;
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bank_statement_highlights' AND COLUMN_NAME = 'note'`
  );
  if ((rows[0]?.n ?? 0) === 0) {
    await pool.query("ALTER TABLE bank_statement_highlights ADD COLUMN note VARCHAR(1000) NULL").catch(() => {});
  }
  highlightNoteColumnReady = true;
}

/** Self-healing: `marker_id`-Spalte nachrüsten (Verknüpfung Textmarker ↔ Seiten-Marker). */
let highlightMarkerIdColumnReady = false;
async function ensureHighlightMarkerIdColumn(): Promise<void> {
  if (highlightMarkerIdColumnReady) return;
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bank_statement_highlights' AND COLUMN_NAME = 'marker_id'`
  );
  if ((rows[0]?.n ?? 0) === 0) {
    await pool.query("ALTER TABLE bank_statement_highlights ADD COLUMN marker_id INT NULL").catch(() => {});
  }
  highlightMarkerIdColumnReady = true;
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
  /** Position im PDF (nur gesetzt, wenn beim Markieren mit einem Textmarker-Rechteck verknüpft). */
  highlight: { id: number; x: number; y: number; width: number; height: number } | null;
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

/**
 * Liest die saubere Basis-Datei (ohne Textmarker). Migriert einmalig von einer
 * alten Sammel-Datei (vor der Trennung Basis/Anzeige), falls vorhanden.
 */
async function getBaseFile(): Promise<Buffer | null> {
  try {
    return await readFile(BASE_PATH);
  } catch {
    try {
      const legacy = await readFile(DISPLAY_PATH);
      await mkdir(KONTOAUSZUEGE_DIR, { recursive: true });
      await writeFile(BASE_PATH, legacy);
      return legacy;
    } catch {
      return null;
    }
  }
}

const STAMP_TEXT = "GEPRÜFT";

/** Zeichnet den großen, halbtransparenten "GEPRÜFT"-Stempel diagonal über die Seitenmitte. */
function drawStampOnPage(pdfPage: PDFPage, font: PDFFont): void {
  const pageWidth = pdfPage.getWidth();
  const pageHeight = pdfPage.getHeight();
  const angleDeg = 25;
  const angleRad = (angleDeg * Math.PI) / 180;
  // Zielbreite: etwas größer als die kleinere Seitenkante, wirkt wie ein großer Papierstempel.
  const targetWidth = Math.min(pageWidth, pageHeight) * 1.15;
  const widthAtSize1 = font.widthOfTextAtSize(STAMP_TEXT, 1) || 1;
  const size = targetWidth / widthAtSize1;
  const textWidth = font.widthOfTextAtSize(STAMP_TEXT, size);
  const cx = pageWidth / 2;
  const cy = pageHeight / 2;
  // Start der Grundlinie so wählen, dass ihre Mitte auf die Seitenmitte fällt.
  const x0 = cx - (textWidth / 2) * Math.cos(angleRad);
  const y0 = cy - (textWidth / 2) * Math.sin(angleRad);
  pdfPage.drawText(STAMP_TEXT, {
    x: x0,
    y: y0,
    size,
    font,
    color: rgb(0.1, 0.5, 0.15),
    opacity: 0.3,
    rotate: degrees(angleDeg),
  });
}

/** Baut die angezeigte Datei (Basis + alle aktiven Textmarker + Stempel) aus der Basis neu auf. */
async function rebuildDisplayFile(): Promise<void> {
  const base = await getBaseFile();
  if (!base) {
    await unlink(DISPLAY_PATH).catch(() => {});
    return;
  }
  const pdf = await PDFDocument.load(base, { ignoreEncryption: true });
  const pageCount = pdf.getPageCount();
  await ensureTables();
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT page, x, y, width, height, color FROM bank_statement_highlights ORDER BY id ASC`
  );
  for (const r of rows) {
    const index = Number(r.page) - 1;
    if (index < 0 || index >= pageCount) continue; // Sicherheitsnetz, sollte nicht vorkommen
    const pdfPage = pdf.getPage(index);
    const [red, green, blue] = markerColorRgb01(normalizeColor(r.color));
    pdfPage.drawRectangle({
      x: Number(r.x),
      y: Number(r.y),
      width: Number(r.width),
      height: Number(r.height),
      color: rgb(red, green, blue),
      opacity: 0.35,
      borderWidth: 0,
    });
  }

  const [stampRows] = await getPool().query<RowDataPacket[]>(`SELECT page FROM bank_statement_stamps ORDER BY id ASC`);
  if (stampRows.length > 0) {
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    for (const r of stampRows) {
      const index = Number(r.page) - 1;
      if (index < 0 || index >= pageCount) continue;
      drawStampOnPage(pdf.getPage(index), font);
    }
  }

  // Zeilen-Zuordnungen: grün, wenn die Summe der zugeordneten Belege zum
  // eingetragenen Betrag passt, sonst rot.
  const [lineRows] = await getPool().query<RowDataPacket[]>(
    `SELECT id, page, x, y, width, height, amount FROM bank_statement_lines ORDER BY id ASC`
  );
  if (lineRows.length > 0) {
    const lineIds = lineRows.map((r) => r.id);
    const [sumRows] = await getPool().query<RowDataPacket[]>(
      `SELECT line_id, SUM(amount) AS total FROM bank_statement_line_receipts
       WHERE line_id IN (${lineIds.map(() => "?").join(",")}) GROUP BY line_id`,
      lineIds
    );
    const sumByLine = new Map<number, number>();
    for (const r of sumRows) sumByLine.set(Number(r.line_id), Number(r.total));
    const GREEN = rgb(0.13, 0.7, 0.2);
    const RED = rgb(0.85, 0.15, 0.15);
    for (const r of lineRows) {
      const index = Number(r.page) - 1;
      if (index < 0 || index >= pageCount) continue;
      const pdfPage = pdf.getPage(index);
      const sum = sumByLine.get(Number(r.id)) ?? 0;
      const matched = Math.abs(sum - Number(r.amount)) < 0.01;
      pdfPage.drawRectangle({
        x: Number(r.x),
        y: Number(r.y),
        width: Number(r.width),
        height: Number(r.height),
        color: matched ? GREEN : RED,
        opacity: 0.3,
        borderWidth: 0,
      });
    }
  }

  await mkdir(KONTOAUSZUEGE_DIR, { recursive: true });
  await writeFile(DISPLAY_PATH, await pdf.save());
}

/** Liest die angezeigte Datei (Basis + Textmarker) zum Anzeigen/Herunterladen. */
export async function getStatementFile(): Promise<Buffer | null> {
  try {
    return await readFile(DISPLAY_PATH);
  } catch {
    // Erster Aufruf nach dem Umstieg auf Basis/Anzeige getrennt: Anzeige-Datei
    // fehlt evtl. noch, obwohl schon Auszüge/eine alte Datei vorhanden sind.
    const base = await getBaseFile();
    if (!base) return null;
    await rebuildDisplayFile();
    try {
      return await readFile(DISPLAY_PATH);
    } catch {
      return null;
    }
  }
}

/**
 * Wie `getStatementFile`, zeichnet aber zusätzlich (nur für diese eine
 * Anfrage, nicht dauerhaft gespeichert) einen blauen Rahmen um eine
 * bestimmte Markierung – damit beim Springen von einem Marker aus sofort
 * erkennbar ist, welche der Markierungen auf der Seite gemeint ist.
 */
export async function getStatementFileWithSelection(highlightId: number | null): Promise<Buffer | null> {
  const display = await getStatementFile();
  if (!display || highlightId == null) return display;
  await ensureTables();
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT page, x, y, width, height FROM bank_statement_highlights WHERE id = ?`,
    [highlightId]
  );
  const h = rows[0];
  if (!h) return display;
  try {
    const pdf = await PDFDocument.load(display, { ignoreEncryption: true });
    const index = Number(h.page) - 1;
    if (index < 0 || index >= pdf.getPageCount()) return display;
    const pdfPage = pdf.getPage(index);
    const pad = 3; // etwas Abstand, damit der Rahmen nicht direkt auf der Markierung liegt
    pdfPage.drawRectangle({
      x: Number(h.x) - pad,
      y: Number(h.y) - pad,
      width: Number(h.width) + pad * 2,
      height: Number(h.height) + pad * 2,
      borderColor: rgb(0.15, 0.39, 0.92),
      borderWidth: 2.5,
    });
    return Buffer.from(await pdf.save());
  } catch {
    return display;
  }
}

/** Gesamtzahl Seiten der Sammel-Datei (aus der Upload-Historie, kein erneutes PDF-Parsen nötig). */
export async function getStatementPageCount(): Promise<number> {
  await ensureTables();
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(page_count), 0) AS total FROM bank_statement_uploads`
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Fügt eine neue PDF-Datei VORN in die Basis-Sammel-Datei ein (neuester
 * Auszug = Seite 1); bestehende Seiten rutschen nach hinten. Bisherige
 * Marker, Textmarker und Upload-Einträge werden dabei automatisch um die
 * Anzahl neuer Seiten verschoben, damit sie weiter auf dieselbe Stelle zeigen.
 */
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

  const existing = await getBaseFile();
  let pageCount: number;
  try {
    // Neues Dokument: erst die neuen Seiten, danach die bisherigen (falls vorhanden).
    const merged = await PDFDocument.create();
    const incoming = await PDFDocument.load(input.buffer, { ignoreEncryption: true });
    const incomingPages = await merged.copyPages(incoming, incoming.getPageIndices());
    for (const page of incomingPages) merged.addPage(page);
    pageCount = incomingPages.length;

    if (existing) {
      const existingDoc = await PDFDocument.load(existing, { ignoreEncryption: true });
      const existingPages = await merged.copyPages(existingDoc, existingDoc.getPageIndices());
      for (const page of existingPages) merged.addPage(page);
    }
    await writeFile(BASE_PATH, await merged.save());
  } catch (e) {
    if (e instanceof Error && e.message.includes("angehängt")) throw e;
    throw new Error("PDF konnte nicht gelesen/angehängt werden (beschädigt oder kein gültiges PDF?).");
  }

  const pool = getPool();
  // Bisherige Seitenzahlen rutschen um `pageCount` nach hinten.
  await pool.query(`UPDATE bank_statement_markers SET page = page + ?`, [pageCount]);
  await pool.query(`UPDATE bank_statement_highlights SET page = page + ?`, [pageCount]);
  await pool.query(`UPDATE bank_statement_stamps SET page = page + ?`, [pageCount]);
  await pool.query(`UPDATE bank_statement_lines SET page = page + ?`, [pageCount]);
  await pool.query(`UPDATE bank_statement_uploads SET page_start = page_start + ?`, [pageCount]);
  await pool.query(
    `INSERT INTO bank_statement_uploads (filename, page_start, page_count, added_by) VALUES (?, 1, ?, ?)`,
    [input.originalName.slice(0, 255), pageCount, input.userId]
  );
  await rebuildDisplayFile();
  return { pageStart: 1, pageCount };
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
 * entfernt dessen Seiten vom Anfang der Basis-Datei (neue Anhänge landen immer
 * vorn, Seite 1..N) und löscht Marker/Textmarker auf diesen Seiten. Die übrigen
 * Einträge rutschen wieder um die entfernte Seitenzahl nach vorn.
 */
export async function undoLastStatementUpload(): Promise<void> {
  await ensureTables();
  const pool = getPool();
  const [rows] = await pool.query<UploadRow[]>(
    `SELECT id, page_start, page_count FROM bank_statement_uploads ORDER BY id DESC LIMIT 1`
  );
  const last = rows[0];
  if (!last) return;
  const removeCount = last.page_count;

  const existing = await getBaseFile();
  if (existing) {
    const pdf = await PDFDocument.load(existing, { ignoreEncryption: true });
    // Die ersten `removeCount` Seiten entfernen; von hinten nach vorn, sonst
    // verschieben sich die Indizes der noch zu entfernenden Seiten.
    for (let i = removeCount - 1; i >= 0; i--) pdf.removePage(i);
    await writeFile(BASE_PATH, await pdf.save());
  }

  const range: number[] = [last.page_start, last.page_start + last.page_count - 1];
  await pool.query(`DELETE FROM bank_statement_markers WHERE page >= ? AND page <= ?`, range);
  await pool.query(`DELETE FROM bank_statement_highlights WHERE page >= ? AND page <= ?`, range);
  await pool.query(`DELETE FROM bank_statement_stamps WHERE page >= ? AND page <= ?`, range);
  await pool.query(
    `DELETE FROM bank_statement_line_receipts WHERE line_id IN (
       SELECT id FROM bank_statement_lines WHERE page >= ? AND page <= ?
     )`,
    range
  );
  await pool.query(`DELETE FROM bank_statement_lines WHERE page >= ? AND page <= ?`, range);
  await pool.query(`DELETE FROM bank_statement_uploads WHERE id = ?`, [last.id]);
  // Verbleibende Marker/Textmarker/Stempel/Zeilen/Uploads wieder nach vorn rutschen lassen.
  await pool.query(`UPDATE bank_statement_markers SET page = page - ?`, [removeCount]);
  await pool.query(`UPDATE bank_statement_highlights SET page = page - ?`, [removeCount]);
  await pool.query(`UPDATE bank_statement_stamps SET page = page - ?`, [removeCount]);
  await pool.query(`UPDATE bank_statement_lines SET page = page - ?`, [removeCount]);
  await pool.query(`UPDATE bank_statement_uploads SET page_start = page_start - ?`, [removeCount]);
  await rebuildDisplayFile();
}

interface MarkerRow extends RowDataPacket {
  id: number;
  page: number;
  note: string;
  color: string;
  created_at: string | null;
  created_by_name: string | null;
  hid: number | null;
  hx: number | string | null;
  hy: number | string | null;
  hwidth: number | string | null;
  hheight: number | string | null;
}

/** Alle Markierungen, nach Seite sortiert. Enthält die genaue Position, falls mit einem Textmarker-Rechteck verknüpft. */
export async function listStatementMarkers(): Promise<StatementMarker[]> {
  await ensureTables();
  const [rows] = await getPool().query<MarkerRow[]>(
    `SELECT m.id, m.page, m.note, m.color, m.created_at,
            COALESCE(NULLIF(u.display_name, ''), u.username) AS created_by_name,
            h.id AS hid, h.x AS hx, h.y AS hy, h.width AS hwidth, h.height AS hheight
     FROM bank_statement_markers m
     LEFT JOIN users u ON u.id = m.created_by
     LEFT JOIN bank_statement_highlights h ON h.marker_id = m.id
     ORDER BY m.page ASC, m.id ASC`
  );
  return rows.map((r) => ({
    id: r.id,
    page: r.page,
    note: r.note,
    color: normalizeColor(r.color),
    createdByName: r.created_by_name,
    createdAt: r.created_at ? String(r.created_at) : null,
    highlight:
      r.hid != null && r.hx != null && r.hy != null && r.hwidth != null && r.hheight != null
        ? { id: r.hid, x: Number(r.hx), y: Number(r.hy), width: Number(r.hwidth), height: Number(r.hheight) }
        : null,
  }));
}

/** Legt eine Markierung (Seite + Notiz + Farbe) an. Gibt die neue ID zurück (oder null bei leerer Notiz). */
export async function addStatementMarker(input: {
  page: number;
  note: string;
  color?: string;
  userId: number | null;
}): Promise<number | null> {
  await ensureTables();
  const note = input.note.trim().slice(0, 1000);
  if (!note) return null;
  const page = Math.max(1, Math.trunc(input.page));
  const color = normalizeColor(input.color);
  const [result] = await getPool().query(
    `INSERT INTO bank_statement_markers (page, note, color, created_by) VALUES (?, ?, ?, ?)`,
    [page, note, color, input.userId]
  );
  return (result as { insertId?: number }).insertId ?? null;
}

/**
 * Löscht eine Markierung. War sie beim Erstellen mit einem Textmarker-Rechteck
 * verknüpft (Notiz beim Markieren im PDF), wird dieses gleich mitgelöscht und
 * die angezeigte Datei neu aufgebaut – sonst bliebe die Markierung im PDF
 * sichtbar, obwohl die zugehörige Notiz schon weg ist.
 */
export async function deleteStatementMarker(id: number): Promise<void> {
  await ensureTables();
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT id FROM bank_statement_highlights WHERE marker_id = ?`, [id]);
  const highlightIds = rows.map((r) => Number(r.id));
  await pool.query(`DELETE FROM bank_statement_markers WHERE id = ?`, [id]);
  if (highlightIds.length > 0) {
    await pool.query(
      `DELETE FROM bank_statement_highlights WHERE id IN (${highlightIds.map(() => "?").join(",")})`,
      highlightIds
    );
    await rebuildDisplayFile();
  }
}

/** Ein Textmarker-Rechteck in PDF-Punkten (Ursprung unten links), wie von pdf-lib erwartet. */
export interface HighlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  /** Optional: legt zusätzlich einen durchsuchbaren Seiten-Marker mit dieser Notiz an. */
  note?: string;
}

export interface StatementHighlight {
  id: number;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: MarkerColor;
  note: string | null;
  createdByName: string | null;
  createdAt: string | null;
}

interface HighlightRow extends RowDataPacket {
  id: number;
  page: number;
  x: number | string;
  y: number | string;
  width: number | string;
  height: number | string;
  color: string;
  note: string | null;
  created_at: string | null;
  created_by_name: string | null;
}

/** Textmarker-Rechtecke einer Seite (zum Anzeigen/Löschen im Markieren-Fenster). */
export async function listStatementHighlights(page: number): Promise<StatementHighlight[]> {
  await ensureTables();
  const [rows] = await getPool().query<HighlightRow[]>(
    `SELECT h.id, h.page, h.x, h.y, h.width, h.height, h.color, h.note, h.created_at,
            COALESCE(NULLIF(u.display_name, ''), u.username) AS created_by_name
     FROM bank_statement_highlights h
     LEFT JOIN users u ON u.id = h.created_by
     WHERE h.page = ?
     ORDER BY h.id ASC`,
    [page]
  );
  return rows.map((r) => ({
    id: r.id,
    page: r.page,
    x: Number(r.x),
    y: Number(r.y),
    width: Number(r.width),
    height: Number(r.height),
    color: normalizeColor(r.color),
    note: r.note,
    createdByName: r.created_by_name,
    createdAt: r.created_at ? String(r.created_at) : null,
  }));
}

/**
 * Legt Textmarker-Rechtecke auf einer Seite an (als Daten, nicht direkt ins
 * PDF gebrannt) und baut danach die angezeigte Datei neu auf. Die Notiz wird
 * direkt an der Markierung gespeichert (sichtbar in der Liste im
 * Markieren-Fenster) UND zusätzlich als durchsuchbarer Seiten-Marker angelegt
 * (dieselbe Tabelle wie `addStatementMarker`). Anders als vorher jederzeit
 * über `deleteStatementHighlight` einzeln wieder entfernbar.
 */
export async function drawStatementHighlights(
  page: number,
  rects: HighlightRect[],
  userId: number | null
): Promise<void> {
  if (rects.length === 0) return;
  await ensureTables();
  const base = await getBaseFile();
  if (!base) throw new Error("Noch keine Kontoauszüge hochgeladen.");
  const pdf = await PDFDocument.load(base, { ignoreEncryption: true });
  const index = page - 1;
  if (index < 0 || index >= pdf.getPageCount()) throw new Error("Ungültige Seite.");

  const pool = getPool();
  for (const r of rects) {
    const color = normalizeColor(r.color ?? "yellow");
    const note = r.note?.trim() || null;
    // Marker zuerst anlegen, damit die Markierung direkt mit dessen ID
    // verknüpft werden kann (beide gehören zusammen und sollen sich beim
    // Löschen gegenseitig mitnehmen).
    const markerId = note ? await addStatementMarker({ page, note, color, userId }) : null;
    await pool.query(
      `INSERT INTO bank_statement_highlights (page, x, y, width, height, color, note, marker_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [page, r.x, r.y, r.width, r.height, color, note?.slice(0, 1000) ?? null, markerId, userId]
    );
  }
  await rebuildDisplayFile();
}

/**
 * Löscht ein Textmarker-Rechteck und baut die angezeigte Datei neu auf. War
 * es mit einem Seiten-Marker verknüpft (Notiz beim Markieren im PDF), wird
 * dessen Eintrag in der Markierungs-Liste gleich mitgelöscht.
 */
export async function deleteStatementHighlight(id: number): Promise<void> {
  await ensureTables();
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT marker_id FROM bank_statement_highlights WHERE id = ?`, [id]);
  const markerId = rows[0]?.marker_id ? Number(rows[0].marker_id) : null;
  await pool.query(`DELETE FROM bank_statement_highlights WHERE id = ?`, [id]);
  if (markerId) {
    await pool.query(`DELETE FROM bank_statement_markers WHERE id = ?`, [markerId]);
  }
  await rebuildDisplayFile();
}

export interface StatementStamp {
  id: number;
  page: number;
  createdByName: string | null;
  createdAt: string | null;
}

interface StampRow extends RowDataPacket {
  id: number;
  page: number;
  created_at: string | null;
  created_by_name: string | null;
}

/** Alle gesetzten "Geprüft"-Stempel (für die Anzeige, welche Seiten schon gestempelt sind). */
export async function listStatementStamps(): Promise<StatementStamp[]> {
  await ensureTables();
  const [rows] = await getPool().query<StampRow[]>(
    `SELECT s.id, s.page, s.created_at,
            COALESCE(NULLIF(u.display_name, ''), u.username) AS created_by_name
     FROM bank_statement_stamps s
     LEFT JOIN users u ON u.id = s.created_by
     ORDER BY s.page ASC, s.id ASC`
  );
  return rows.map((r) => ({
    id: r.id,
    page: r.page,
    createdByName: r.created_by_name,
    createdAt: r.created_at ? String(r.created_at) : null,
  }));
}

/** Setzt den "Geprüft"-Stempel groß diagonal auf eine Seite (löschbar wie die Markierungen). */
export async function addStatementStamp(page: number, userId: number | null): Promise<void> {
  await ensureTables();
  const base = await getBaseFile();
  if (!base) throw new Error("Noch keine Kontoauszüge hochgeladen.");
  const pdf = await PDFDocument.load(base, { ignoreEncryption: true });
  const p = Math.max(1, Math.trunc(page));
  if (p - 1 < 0 || p - 1 >= pdf.getPageCount()) throw new Error("Ungültige Seite.");
  await getPool().query(`INSERT INTO bank_statement_stamps (page, created_by) VALUES (?, ?)`, [p, userId]);
  await rebuildDisplayFile();
}

/** Entfernt einen Stempel und baut die angezeigte Datei neu auf. */
export async function deleteStatementStamp(id: number): Promise<void> {
  await ensureTables();
  await getPool().query(`DELETE FROM bank_statement_stamps WHERE id = ?`, [id]);
  await rebuildDisplayFile();
}

/**
 * Zeilen-Zuordnung: eine markierte Zeile im Kontoauszug mit einem Soll-Betrag,
 * dem ein oder mehrere Belege zugeordnet werden können. Stimmt die Summe der
 * zugeordneten Belege mit dem Betrag überein, erscheint die Zeile im PDF grün,
 * sonst rot (siehe `rebuildDisplayFile`).
 */
export interface LineReceipt {
  id: number;
  kind: "manual" | "hero";
  ref: string;
  amount: number;
  supplier: string | null;
  invoiceNumber: string | null;
  settlementKind: "full" | "skonto" | "partial";
}

export interface StatementLine {
  id: number;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  amount: number;
  /** Buchungsdatum (yyyy-mm-dd), falls erkannt/erfasst – wird als Bezahldatum verwendet. */
  date: string | null;
  receipts: LineReceipt[];
  matched: boolean;
  /** true, sobald beim Matchen der Zahlstatus der zugeordneten Belege gesetzt wurde (einmalig). */
  paidApplied: boolean;
  createdByName: string | null;
  createdAt: string | null;
}

interface LineRow extends RowDataPacket {
  id: number;
  page: number;
  x: number | string;
  y: number | string;
  width: number | string;
  height: number | string;
  amount: number | string;
  date: string | null;
  paid_applied: number;
  created_at: string | null;
  created_by_name: string | null;
}

interface LineReceiptRow extends RowDataPacket {
  id: number;
  line_id: number;
  receipt_kind: string;
  receipt_ref: string;
  amount: number | string;
  settlement_kind: string;
  supplier: string | null;
  invoice_number: string | null;
}

/** Alle Zeilen-Zuordnungen einer Seite inkl. zugeordneter Belege und Abgleich-Status. */
export async function listStatementLines(page: number): Promise<StatementLine[]> {
  await ensureTables();
  const [lineRows] = await getPool().query<LineRow[]>(
    `SELECT l.id, l.page, l.x, l.y, l.width, l.height, l.amount, l.date, l.paid_applied, l.created_at,
            COALESCE(NULLIF(u.display_name, ''), u.username) AS created_by_name
     FROM bank_statement_lines l
     LEFT JOIN users u ON u.id = l.created_by
     WHERE l.page = ?
     ORDER BY l.id ASC`,
    [page]
  );
  if (lineRows.length === 0) return [];
  const ids = lineRows.map((r) => r.id);
  const [receiptRows] = await getPool().query<LineReceiptRow[]>(
    `SELECT id, line_id, receipt_kind, receipt_ref, amount, settlement_kind, supplier, invoice_number
     FROM bank_statement_line_receipts WHERE line_id IN (${ids.map(() => "?").join(",")}) ORDER BY id ASC`,
    ids
  );
  const byLine = new Map<number, LineReceipt[]>();
  for (const r of receiptRows) {
    const list = byLine.get(r.line_id) ?? [];
    list.push({
      id: r.id,
      kind: r.receipt_kind === "hero" ? "hero" : "manual",
      ref: r.receipt_ref,
      amount: Number(r.amount),
      supplier: r.supplier,
      invoiceNumber: r.invoice_number,
      settlementKind: r.settlement_kind === "skonto" || r.settlement_kind === "partial" ? r.settlement_kind : "full",
    });
    byLine.set(r.line_id, list);
  }
  return lineRows.map((r) => {
    const receipts = byLine.get(r.id) ?? [];
    const sum = receipts.reduce((s, x) => s + x.amount, 0);
    const amount = Number(r.amount);
    return {
      id: r.id,
      page: r.page,
      x: Number(r.x),
      y: Number(r.y),
      width: Number(r.width),
      height: Number(r.height),
      amount,
      date: r.date ? String(r.date).slice(0, 10) : null,
      receipts,
      matched: Math.abs(sum - amount) < 0.01,
      paidApplied: Number(r.paid_applied) === 1,
      createdByName: r.created_by_name,
      createdAt: r.created_at ? String(r.created_at) : null,
    };
  });
}

/** Legt eine neue Zeilen-Zuordnung an (Rechteck + Soll-Betrag + Buchungsdatum). Gibt die neue ID zurück. */
export async function addStatementLine(input: {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  amount: number;
  date: string | null;
  userId: number | null;
}): Promise<number> {
  await ensureTables();
  const base = await getBaseFile();
  if (!base) throw new Error("Noch keine Kontoauszüge hochgeladen.");
  const pdf = await PDFDocument.load(base, { ignoreEncryption: true });
  const index = input.page - 1;
  if (index < 0 || index >= pdf.getPageCount()) throw new Error("Ungültige Seite.");
  const [result] = await getPool().query(
    `INSERT INTO bank_statement_lines (page, x, y, width, height, amount, date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.page, input.x, input.y, input.width, input.height, input.amount, input.date, input.userId]
  );
  await rebuildDisplayFile();
  return (result as { insertId?: number }).insertId ?? 0;
}

/**
 * Legt mehrere Zeilen-Zuordnungen auf einmal an (automatische Erkennung über
 * den PDF-Text-Layer, client-seitig erkannt und hier nur noch gespeichert).
 * Baut die angezeigte Datei erst am Ende EINMAL neu auf statt je Zeile.
 * Überspringt Zeilen, die schon eine sehr ähnlich positionierte bestehende
 * Zeile auf derselben Seite haben (Dubletten-Schutz bei mehrfachem Ausführen).
 */
export async function addStatementLinesBatch(
  items: { page: number; x: number; y: number; width: number; height: number; amount: number; date: string | null }[],
  userId: number | null
): Promise<number> {
  if (items.length === 0) return 0;
  await ensureTables();
  const base = await getBaseFile();
  if (!base) throw new Error("Noch keine Kontoauszüge hochgeladen.");
  const pdf = await PDFDocument.load(base, { ignoreEncryption: true });
  const pageCount = pdf.getPageCount();
  const pool = getPool();

  // Bestehende Zeilen je betroffener Seite einmal laden (statt pro Element erneut).
  const pages = [...new Set(items.map((it) => it.page))];
  const existingByPage = new Map<number, { y: number; height: number }[]>();
  for (const p of pages) {
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT y, height FROM bank_statement_lines WHERE page = ?`, [p]);
    existingByPage.set(
      p,
      rows.map((r) => ({ y: Number(r.y), height: Number(r.height) }))
    );
  }

  let created = 0;
  for (const it of items) {
    const index = it.page - 1;
    if (index < 0 || index >= pageCount) continue;
    const existing = existingByPage.get(it.page) ?? [];
    const centerY = it.y + it.height / 2;
    const isDuplicate = existing.some((r) => Math.abs(r.y + r.height / 2 - centerY) < 6);
    if (isDuplicate) continue;
    await pool.query(
      `INSERT INTO bank_statement_lines (page, x, y, width, height, amount, date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [it.page, it.x, it.y, it.width, it.height, it.amount, it.date, userId]
    );
    existing.push({ y: it.y, height: it.height });
    created++;
  }
  if (created > 0) await rebuildDisplayFile();
  return created;
}

/**
 * Löscht eine Zeilen-Zuordnung samt zugeordneter Belege und baut die
 * angezeigte Datei neu auf. War der Zahlstatus für diese Zeile bereits
 * gesetzt (`paid_applied`), wird er für jeden zugeordneten Beleg vorher
 * zurückgenommen (siehe `revertReceiptPaymentEffect`).
 */
export async function deleteStatementLine(id: number, userId: number | null = null): Promise<void> {
  await ensureTables();
  const pool = getPool();
  const [lineRows] = await pool.query<RowDataPacket[]>(`SELECT paid_applied FROM bank_statement_lines WHERE id = ?`, [
    id,
  ]);
  if (Number(lineRows[0]?.paid_applied) === 1) {
    const [receiptRows] = await pool.query<RowDataPacket[]>(
      `SELECT receipt_kind, receipt_ref, amount, settlement_kind FROM bank_statement_line_receipts WHERE line_id = ?`,
      [id]
    );
    for (const r of receiptRows) {
      await revertReceiptPaymentEffect(
        {
          kind: r.receipt_kind === "hero" ? "hero" : "manual",
          ref: String(r.receipt_ref),
          amount: Number(r.amount),
          settlementKind: String(r.settlement_kind),
        },
        userId
      );
    }
  }
  await pool.query(`DELETE FROM bank_statement_line_receipts WHERE line_id = ?`, [id]);
  await pool.query(`DELETE FROM bank_statement_lines WHERE id = ?`, [id]);
  await rebuildDisplayFile();
}

/** full = voller offener Betrag, skonto = exakt der hinterlegte Skonto-Zahlbetrag, partial = weniger (Teilzahlung). */
function classifySettlement(confirmedAmount: number, openAmount: number, skontoPayAmount: number | null): "full" | "skonto" | "partial" {
  if (Math.abs(confirmedAmount - openAmount) < 0.01) return "full";
  if (skontoPayAmount != null && Math.abs(confirmedAmount - skontoPayAmount) < 0.01) return "skonto";
  if (confirmedAmount < openAmount) return "partial";
  return "full"; // Ausnahmefall (zugeordnet > offen) – wie voll behandeln
}

/**
 * Ordnet einer Zeile einen weiteren Beleg zu (mehrere Belege je Zeile möglich).
 * `amount` ist der vom Nutzer bestätigte (ggf. angepasste) Betrag; `openAmount`
 * und `skontoPayAmount` (nur manuell, sonst null) stammen aus der Suche und
 * bestimmen, ob dies als volle Zahlung, Skonto-Zahlung oder Teilzahlung gilt.
 * Erreicht die Zeile danach ihren Soll-Betrag, wird der Zahlstatus automatisch
 * gesetzt (siehe `applyLineReceiptPaymentEffects`).
 */
export async function addReceiptToLine(
  lineId: number,
  receipt: {
    kind: "manual" | "hero";
    ref: string;
    amount: number;
    openAmount: number;
    skontoPayAmount: number | null;
    supplier: string | null;
    invoiceNumber: string | null;
  },
  userId: number | null
): Promise<void> {
  await ensureTables();
  const settlementKind = classifySettlement(receipt.amount, receipt.openAmount, receipt.skontoPayAmount);
  await getPool().query(
    `INSERT INTO bank_statement_line_receipts (line_id, receipt_kind, receipt_ref, amount, settlement_kind, supplier, invoice_number) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [lineId, receipt.kind, receipt.ref, receipt.amount, settlementKind, receipt.supplier, receipt.invoiceNumber]
  );
  await rebuildDisplayFile();
  await applyLineReceiptPaymentEffects(lineId, userId);
}

/**
 * Setzt, sobald eine Zeile ihren Soll-Betrag erreicht hat (grün), einmalig den
 * Zahlstatus der zugeordneten Belege – passend zur beim Zuordnen ermittelten
 * Art (voll/Skonto/Teilzahlung). Bezahldatum = Buchungsdatum der Zeile, falls
 * bekannt, sonst heute. Läuft nur EINMAL pro Zeile (Flag `paid_applied`) –
 * nachträgliches Entfernen/Hinzufügen von Belegen auf einer bereits
 * abgeschlossenen Zeile ändert den Zahlstatus NICHT nochmal automatisch
 * (bewusst, um Doppel-Verbuchungen bei Teilzahlungen zu vermeiden; manuelle
 * Korrektur dann über die normale Belegliste).
 */
async function applyLineReceiptPaymentEffects(lineId: number, userId: number | null): Promise<void> {
  const pool = getPool();
  const [lineRows] = await pool.query<RowDataPacket[]>(
    `SELECT amount, date, paid_applied FROM bank_statement_lines WHERE id = ?`,
    [lineId]
  );
  const line = lineRows[0];
  if (!line || Number(line.paid_applied) === 1) return;

  const [receiptRows] = await pool.query<RowDataPacket[]>(
    `SELECT receipt_kind, receipt_ref, amount, settlement_kind FROM bank_statement_line_receipts WHERE line_id = ?`,
    [lineId]
  );
  if (receiptRows.length === 0) return;
  const sum = receiptRows.reduce((s, r) => s + Number(r.amount), 0);
  if (Math.abs(sum - Number(line.amount)) >= 0.01) return; // noch nicht vollständig zugeordnet

  const paidDate: string | undefined = line.date ? String(line.date).slice(0, 10) : undefined;
  for (const r of receiptRows) {
    const kind = r.settlement_kind === "skonto" || r.settlement_kind === "partial" ? r.settlement_kind : "full";
    const amount = Number(r.amount);
    if (r.receipt_kind === "manual") {
      const id = Number(r.receipt_ref);
      if (kind === "partial") {
        await addManualReceiptPartialPayment(id, amount, userId, paidDate).catch(() => {});
      } else {
        await setManualReceiptPaid(id, true, kind === "skonto", userId, paidDate).catch(() => {});
      }
    } else {
      const eur = amount.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
      const kindLabel = kind === "partial" ? "Teilzahlung" : kind === "skonto" ? "mit Skonto" : "voll";
      const remark = `Kontoauszug-Abgleich${paidDate ? ` vom ${paidDate}` : ""}: ${eur} (${kindLabel})`;
      // HERO kennt lokal nur "bezahlt"/"offen" (kein Skonto-Flag, keine Teilzahlungs-
      // Summierung) – bei Teilzahlung bleibt der Status "offen", nur als Notiz vermerkt.
      await setPaymentOverride(r.receipt_ref, kind === "partial" ? "offen" : "bezahlt", userId, undefined, remark).catch(
        () => {}
      );
    }
  }
  await pool.query(`UPDATE bank_statement_lines SET paid_applied = 1 WHERE id = ?`, [lineId]);
}

/**
 * Macht den in `applyLineReceiptPaymentEffects` gesetzten Zahlstatus für
 * EINEN zugeordneten Beleg wieder rückgängig (Gegenstück dazu). Wird
 * aufgerufen, bevor eine Beleg-Zuordnung entfernt oder eine ganze Zeile
 * gelöscht wird, deren Zahlstatus bereits übernommen war.
 */
async function revertReceiptPaymentEffect(
  receipt: { kind: "manual" | "hero"; ref: string; amount: number; settlementKind: string },
  userId: number | null
): Promise<void> {
  if (receipt.kind === "manual") {
    const id = Number(receipt.ref);
    if (receipt.settlementKind === "partial") {
      await reduceManualReceiptPartialPayment(id, receipt.amount, userId).catch(() => {});
    } else {
      await setManualReceiptPaid(id, false, false, userId).catch(() => {});
    }
  } else if (receipt.settlementKind !== "partial") {
    // HERO kennt keine Teilzahlung – bei "partial" wurde der Status gar nicht
    // verändert (blieb "offen"), nur eine Notiz vermerkt, also nichts zu tun.
    // Bei voll/Skonto den Override entfernen → es gilt wieder der echte HERO-Status.
    await clearPaymentOverride(receipt.ref).catch(() => {});
  }
}

/**
 * Entfernt einen zugeordneten Beleg von einer Zeile und baut die angezeigte
 * Datei neu auf. War der Zahlstatus für diese Zeile bereits übernommen
 * (`paid_applied`), wird er für diesen Beleg vorher zurückgenommen und das
 * Flag der Zeile wieder auf "noch nicht gesetzt" zurückgestellt, damit eine
 * spätere korrekte Zuordnung den Status erneut setzen kann.
 */
export async function removeReceiptFromLine(linkId: number, userId: number | null = null): Promise<void> {
  await ensureTables();
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT lr.line_id, lr.receipt_kind, lr.receipt_ref, lr.amount, lr.settlement_kind, l.paid_applied
     FROM bank_statement_line_receipts lr
     JOIN bank_statement_lines l ON l.id = lr.line_id
     WHERE lr.id = ?`,
    [linkId]
  );
  const row = rows[0];
  if (row && Number(row.paid_applied) === 1) {
    await revertReceiptPaymentEffect(
      {
        kind: row.receipt_kind === "hero" ? "hero" : "manual",
        ref: String(row.receipt_ref),
        amount: Number(row.amount),
        settlementKind: String(row.settlement_kind),
      },
      userId
    );
    await pool.query(`UPDATE bank_statement_lines SET paid_applied = 0 WHERE id = ?`, [row.line_id]);
  }
  await pool.query(`DELETE FROM bank_statement_line_receipts WHERE id = ?`, [linkId]);
  await rebuildDisplayFile();
}

export interface AssignableReceiptOption {
  kind: "manual" | "hero";
  ref: string;
  /** Vorgeschlagener Betrag = offener Restbetrag (editierbar vor dem Zuordnen). */
  amount: number;
  supplier: string | null;
  invoiceNumber: string | null;
  date: string | null;
  /** Skonto-Zahlbetrag (nur manuelle Belege, sonst null – HERO kennt keinen Skonto). */
  skontoPayAmount: number | null;
}

/**
 * Sucht Belege (manuell + HERO, beide Richtungen, letzte 3 Jahre) nach
 * Lieferant/Kunde, Belegnummer ODER Volltext (derselbe OCR-Index wie die
 * normale Belege-Suche unter /dashboard/belege) – zum Zuordnen zu einer
 * Kontoauszug-Zeile. Direkter Feldabgleich allein reicht oft nicht (z. B.
 * wenn der HERO-Kontaktname vom Namen auf der Rechnung abweicht), daher
 * zusätzlich über den Volltext.
 */
export async function searchAssignableReceipts(query: string): Promise<{ results: AssignableReceiptOption[]; error?: string }> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return { results: [] };
  const results: AssignableReceiptOption[] = [];
  let manualOk = false;
  let heroOk = false;
  let manualError: string | undefined;
  let heroError: string | undefined;

  try {
    const [manualReceipts, manualOcrIds] = await Promise.all([listAllManualReceipts(), searchManualOcrIds(q)]);
    for (const r of manualReceipts) {
      if (r.openAmount <= 0.01) continue; // nur offene (bzw. teilweise bezahlte) Belege
      const hit =
        (r.supplier ?? "").toLowerCase().includes(q) ||
        (r.invoiceNumber ?? "").toLowerCase().includes(q) ||
        manualOcrIds.has(r.id);
      if (!hit) continue;
      results.push({
        kind: "manual",
        ref: String(r.id),
        // Offener Restbetrag (bei Teilzahlung weniger als der volle Brutto-Betrag).
        amount: r.openAmount,
        supplier: r.supplier,
        invoiceNumber: r.invoiceNumber,
        date: r.date,
        skontoPayAmount: r.skontoPayAmount,
      });
      if (results.length >= 20) break;
    }
    manualOk = true;
  } catch (e) {
    manualError = e instanceof Error ? e.message : "Manuelle Beleg-Suche fehlgeschlagen.";
  }

  try {
    const to = new Date();
    const from = new Date();
    from.setFullYear(from.getFullYear() - 3);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const [heroReceipts, heroOcrIds, overrides] = await Promise.all([
      getReceiptsInRange(`${fmt(from)}T00:00:00Z`, `${fmt(to)}T23:59:59Z`),
      searchOcrHeroIds(q),
      getPaymentOverrideMap(),
    ]);
    for (const r of heroReceipts) {
      // Nur offene (inkl. überfällige) Belege – bereits bezahlte sind für den
      // Abgleich nicht mehr relevant. Lokale Zahlstatus-Übersteuerung (falls
      // gesetzt) hat Vorrang vor dem HERO-eigenen Status, wie im Rest der App.
      const status = effectiveReceiptStatus(r, overrides.get(r.id)?.status ?? null);
      if (status.tone === "paid") continue;
      // Beide Richtungen durchsuchen: "output" = Eingangsrechnungen (wir zahlen,
      // Abgänge vom Konto), "income" = Ausgangsrechnungen (Kunden zahlen uns,
      // Eingänge). Der Kontoauszug enthält beides.
      const supplierName = getCustomerName(r);
      const hit =
        supplierName.toLowerCase().includes(q) || (r.number ?? "").toLowerCase().includes(q) || heroOcrIds.has(r.id);
      if (!hit) continue;
      // Offener Restbetrag (bei Teilzahlung weniger als der volle Rechnungsbetrag).
      const amount = r.openAmount > 0.005 ? r.openAmount : r.value;
      results.push({
        kind: "hero",
        ref: r.id,
        amount,
        supplier: supplierName,
        invoiceNumber: r.number,
        date: r.receiptDate ? r.receiptDate.slice(0, 10) : null,
        skontoPayAmount: null, // HERO kennt keinen Skonto-Zahlbetrag
      });
      if (results.length >= 40) break;
    }
    heroOk = true;
  } catch (e) {
    heroError = e instanceof Error ? e.message : "HERO-Beleg-Suche fehlgeschlagen.";
  }

  const sorted = results.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 30);
  // Nur einen Fehler melden, wenn WIRKLICH beide Quellen scheiterten – sonst
  // könnten (ggf. leere) Ergebnisse einer funktionierenden Quelle fälschlich
  // nach "alles kaputt" aussehen.
  if (!manualOk && !heroOk) {
    return { results: sorted, error: manualError ?? heroError ?? "Suche fehlgeschlagen." };
  }
  return { results: sorted };
}
