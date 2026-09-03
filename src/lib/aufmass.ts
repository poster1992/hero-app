import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";
import { extForMime } from "./file-sniff";
import {
  EMPTY_AUFMASS,
  type AufmassData,
  type AufmassEntry,
  type AufmassStatus,
} from "./aufmass-types";

/** Ablageordner für Aufmaße (Original + Word), konfigurierbar via AUFMASS_DIR. */
const AUFMASS_DIR = process.env.AUFMASS_DIR || path.join(process.cwd(), "data", "aufmasse");

let tableReady = false;

/** Legt die Tabelle bei Bedarf an (self-healing, kein Migrationsskript nötig). */
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await getPool()
    .query(
      `CREATE TABLE IF NOT EXISTS aufmasse (
         id INT AUTO_INCREMENT PRIMARY KEY,
         title VARCHAR(255) NOT NULL DEFAULT 'Aufmaß',
         customer VARCHAR(255) NULL,
         project VARCHAR(255) NULL,
         aufmass_date DATE NULL,
         status VARCHAR(16) NOT NULL DEFAULT 'pending',
         error VARCHAR(500) NULL,
         file_name VARCHAR(255) NULL,
         stored_name VARCHAR(255) NULL,
         mime VARCHAR(100) NULL,
         docx_name VARCHAR(255) NULL,
         docx_stored VARCHAR(255) NULL,
         data LONGTEXT NULL,
         created_by INT NULL,
         created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         INDEX idx_aufmass_created (created)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    )
    .catch(() => {});
  tableReady = true;
}

interface AufmassRow extends RowDataPacket {
  id: number;
  title: string;
  customer: string | null;
  project: string | null;
  aufmass_date: string | Date | null;
  status: string;
  error: string | null;
  file_name: string | null;
  stored_name: string | null;
  mime: string | null;
  docx_name: string | null;
  docx_stored: string | null;
  data: string | null;
  created_by_name: string | null;
  created: string | Date | null;
}

function parseData(raw: string | null): AufmassData {
  if (!raw) return EMPTY_AUFMASS;
  try {
    const parsed = JSON.parse(raw) as AufmassData;
    return { ...EMPTY_AUFMASS, ...parsed, positions: parsed.positions ?? [] };
  } catch {
    return EMPTY_AUFMASS;
  }
}

function mapRow(r: AufmassRow): AufmassEntry {
  const data = parseData(r.data);
  return {
    id: r.id,
    title: r.title,
    customer: r.customer,
    project: r.project,
    date: r.aufmass_date ? String(r.aufmass_date).slice(0, 10) : null,
    status: (["pending", "done", "error"].includes(r.status) ? r.status : "pending") as AufmassStatus,
    error: r.error,
    fileName: r.file_name,
    mime: r.mime,
    hasFile: !!r.stored_name,
    docxName: r.docx_name,
    hasDocx: !!r.docx_stored,
    positionCount: data.positions.length,
    createdByName: r.created_by_name,
    created: r.created ? String(r.created) : null,
  };
}

const SELECT = `
  SELECT a.id, a.title, a.customer, a.project, a.aufmass_date, a.status, a.error,
         a.file_name, a.stored_name, a.mime, a.docx_name, a.docx_stored, a.data, a.created,
         COALESCE(NULLIF(u.display_name, ''), u.username) AS created_by_name
    FROM aufmasse a
    LEFT JOIN users u ON u.id = a.created_by
`;

/** Archiv: alle Aufmaße, neueste zuerst. */
export async function listAufmasse(limit = 200): Promise<AufmassEntry[]> {
  await ensureTable();
  const [rows] = await getPool().query<AufmassRow[]>(
    `${SELECT} ORDER BY a.id DESC LIMIT ?`,
    [Math.max(1, Math.min(limit, 1000))]
  );
  return rows.map(mapRow);
}

/** Ein Aufmaß samt ausgelesenen Daten. */
export async function getAufmass(
  id: number
): Promise<(AufmassEntry & { data: AufmassData }) | null> {
  await ensureTable();
  const [rows] = await getPool().query<AufmassRow[]>(`${SELECT} WHERE a.id = ? LIMIT 1`, [id]);
  const r = rows[0];
  if (!r) return null;
  return { ...mapRow(r), data: parseData(r.data) };
}

/** Speichert die hochgeladene Datei und legt den Datensatz an (Status „pending"). */
export async function createAufmass(
  file: { buffer: Buffer; originalName: string; mime: string },
  createdBy: number | null
): Promise<number> {
  await ensureTable();
  await mkdir(AUFMASS_DIR, { recursive: true });
  const rawExt = path.extname(file.originalName);
  const ext = /^\.[A-Za-z0-9]{1,5}$/.test(rawExt) ? rawExt : extForMime(file.mime);
  const storedName = `${randomUUID()}${ext}`;
  await writeFile(path.join(AUFMASS_DIR, storedName), file.buffer);

  const [res] = await getPool().query(
    `INSERT INTO aufmasse (title, status, file_name, stored_name, mime, created_by)
     VALUES (?, 'pending', ?, ?, ?, ?)`,
    [file.originalName.replace(/\.[^.]+$/, "").slice(0, 200) || "Aufmaß", file.originalName, storedName, file.mime, createdBy]
  );
  return (res as { insertId: number }).insertId;
}

/** Originaldatei eines Aufmaßes (für die Vorschau und die Auswertung). */
export async function getAufmassSource(
  id: number
): Promise<{ data: Buffer; mime: string; name: string } | null> {
  await ensureTable();
  const [rows] = await getPool().query<AufmassRow[]>(
    "SELECT file_name, stored_name, mime FROM aufmasse WHERE id = ? LIMIT 1",
    [id]
  );
  const r = rows[0];
  if (!r?.stored_name) return null;
  try {
    const data = await readFile(path.join(AUFMASS_DIR, r.stored_name));
    return { data, mime: r.mime ?? "application/octet-stream", name: r.file_name ?? "aufmass" };
  } catch {
    return null;
  }
}

/** Erzeugtes Word-Dokument eines Aufmaßes. */
export async function getAufmassDocx(
  id: number
): Promise<{ data: Buffer; name: string } | null> {
  await ensureTable();
  const [rows] = await getPool().query<AufmassRow[]>(
    "SELECT docx_name, docx_stored FROM aufmasse WHERE id = ? LIMIT 1",
    [id]
  );
  const r = rows[0];
  if (!r?.docx_stored) return null;
  try {
    const data = await readFile(path.join(AUFMASS_DIR, r.docx_stored));
    return { data, name: r.docx_name ?? "aufmass.docx" };
  } catch {
    return null;
  }
}

/** Schreibt Auswertung + fertiges Word-Dokument an den Datensatz. */
export async function saveAufmassResult(
  id: number,
  data: AufmassData,
  docx: { buffer: Buffer; fileName: string }
): Promise<void> {
  await ensureTable();
  await mkdir(AUFMASS_DIR, { recursive: true });

  // Vorheriges Word-Dokument ersetzen (z. B. beim erneuten Auswerten).
  const [rows] = await getPool().query<AufmassRow[]>(
    "SELECT docx_stored FROM aufmasse WHERE id = ? LIMIT 1",
    [id]
  );
  const oldDocx = rows[0]?.docx_stored ?? null;

  const storedName = `${randomUUID()}.docx`;
  await writeFile(path.join(AUFMASS_DIR, storedName), docx.buffer);

  const title =
    (data.title && data.title.trim()) ||
    [data.customer, data.project].filter(Boolean).join(" · ") ||
    "Aufmaß";

  await getPool().query(
    `UPDATE aufmasse
        SET title = ?, customer = ?, project = ?, aufmass_date = ?, status = 'done', error = NULL,
            docx_name = ?, docx_stored = ?, data = ?
      WHERE id = ?`,
    [
      title.slice(0, 250),
      data.customer?.slice(0, 250) ?? null,
      data.project?.slice(0, 250) ?? null,
      data.date && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : null,
      docx.fileName.slice(0, 250),
      storedName,
      JSON.stringify(data),
      id,
    ]
  );

  if (oldDocx) {
    try {
      await unlink(path.join(AUFMASS_DIR, oldDocx));
    } catch {
      // Alte Datei evtl. schon weg – ignorieren.
    }
  }
}

/** Markiert ein Aufmaß als fehlgeschlagen (Datei bleibt erhalten). */
export async function setAufmassError(id: number, message: string): Promise<void> {
  await ensureTable();
  await getPool().query("UPDATE aufmasse SET status = 'error', error = ? WHERE id = ?", [
    message.slice(0, 500),
    id,
  ]);
}

/** Löscht ein Aufmaß samt Originaldatei und Word-Dokument. */
export async function deleteAufmass(id: number): Promise<void> {
  await ensureTable();
  const pool = getPool();
  const [rows] = await pool.query<AufmassRow[]>(
    "SELECT stored_name, docx_stored FROM aufmasse WHERE id = ? LIMIT 1",
    [id]
  );
  const r = rows[0];
  await pool.query("DELETE FROM aufmasse WHERE id = ?", [id]);
  for (const name of [r?.stored_name, r?.docx_stored]) {
    if (!name) continue;
    try {
      await unlink(path.join(AUFMASS_DIR, name));
    } catch {
      // Datei evtl. schon weg – ignorieren.
    }
  }
}
