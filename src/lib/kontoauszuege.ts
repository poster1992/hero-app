import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";
import { sniffMime } from "./file-sniff";
import { MARKER_COLORS, type MarkerColor, markerColorRgb01 } from "./kontoauszug-colors";

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
  await ensureMarkerColorColumn();
  await ensureHighlightNoteColumn();
  await ensureHighlightMarkerIdColumn();
  tableReady = true;
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

/** Baut die angezeigte Datei (Basis + alle aktiven Textmarker) aus der Basis neu auf. */
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
  await pool.query(`DELETE FROM bank_statement_uploads WHERE id = ?`, [last.id]);
  // Verbleibende Marker/Textmarker/Uploads wieder nach vorn rutschen lassen.
  await pool.query(`UPDATE bank_statement_markers SET page = page - ?`, [removeCount]);
  await pool.query(`UPDATE bank_statement_highlights SET page = page - ?`, [removeCount]);
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
