import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";
import { extForMime } from "./file-sniff";

/** Ablageordner für Versicherungsunterlagen (konfigurierbar via VERSICHERUNG_DIR). */
const VERSICHERUNG_DIR = process.env.VERSICHERUNG_DIR || path.join(process.cwd(), "data", "versicherungen");

/** Vorgeschlagene Kategorien (frei erweiterbar über das Eingabefeld). */
export const INSURANCE_CATEGORIES = [
  "Flottenvertrag",
  "Kfz-Versicherung",
  "Betriebshaftpflicht",
  "Haftpflichtversicherung",
  "Gebäudeversicherung",
  "Inhaltsversicherung",
  "Rechtsschutzversicherung",
  "Sonstige",
];

export interface InsuranceDocument {
  id: number;
  category: string;
  label: string;
  note: string | null;
  fileName: string | null;
  mime: string | null;
  hasFile: boolean;
  uploadedByName: string | null;
  created: string | null;
}

let tableReady = false;
/** Stellt die Tabelle sicher (einmalig, self-healing). */
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await getPool()
    .query(
      `CREATE TABLE IF NOT EXISTS insurance_documents (
         id INT AUTO_INCREMENT PRIMARY KEY,
         category VARCHAR(120) NOT NULL DEFAULT 'Sonstige',
         label VARCHAR(255) NOT NULL,
         note VARCHAR(2000) NULL,
         file_name VARCHAR(255) NULL,
         stored_name VARCHAR(255) NULL,
         mime VARCHAR(100) NULL,
         uploaded_by INT NULL,
         created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         INDEX idx_ins_cat (category)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    )
    .catch(() => {});
  tableReady = true;
}

interface DocRow extends RowDataPacket {
  id: number;
  category: string;
  label: string;
  note: string | null;
  file_name: string | null;
  stored_name: string | null;
  mime: string | null;
  uploaded_by_name: string | null;
  created: string | null;
}

/** Alle Versicherungsunterlagen (nach Kategorie, dann neueste zuerst). */
export async function listInsuranceDocuments(): Promise<InsuranceDocument[]> {
  await ensureTable();
  const [rows] = await getPool().query<DocRow[]>(
    `SELECT d.id, d.category, d.label, d.note, d.file_name, d.stored_name, d.mime, d.created,
            COALESCE(NULLIF(u.display_name, ''), u.username) AS uploaded_by_name
     FROM insurance_documents d
     LEFT JOIN users u ON u.id = d.uploaded_by
     ORDER BY d.category ASC, d.created DESC, d.id DESC`
  );
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    label: r.label,
    note: r.note,
    fileName: r.file_name,
    mime: r.mime,
    hasFile: !!r.stored_name,
    uploadedByName: r.uploaded_by_name,
    created: r.created ? String(r.created) : null,
  }));
}

/** Legt ein Versicherungsdokument (PDF/Bild/Datei) an. */
export async function addInsuranceDocument(input: {
  category: string;
  label: string;
  note: string | null;
  file: { buffer: Buffer; originalName: string; mime: string };
  uploadedBy: number | null;
}): Promise<void> {
  await ensureTable();
  await mkdir(VERSICHERUNG_DIR, { recursive: true });
  const rawExt = path.extname(input.file.originalName);
  const ext = /^\.[A-Za-z0-9]{1,5}$/.test(rawExt) ? rawExt : extForMime(input.file.mime);
  const storedName = `${randomUUID()}${ext}`;
  await writeFile(path.join(VERSICHERUNG_DIR, storedName), input.file.buffer);
  const category = input.category.trim() || "Sonstige";
  const label = input.label.trim() || input.file.originalName;
  await getPool().query(
    `INSERT INTO insurance_documents (category, label, note, file_name, stored_name, mime, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      category.slice(0, 120),
      label.slice(0, 255),
      input.note?.trim().slice(0, 2000) || null,
      input.file.originalName,
      storedName,
      input.file.mime,
      input.uploadedBy,
    ]
  );
}

/** Ändert Kategorie/Beschriftung/Notiz eines Dokuments. */
export async function updateInsuranceDocument(
  id: number,
  input: { category: string; label: string; note: string | null }
): Promise<void> {
  await ensureTable();
  const category = input.category.trim() || "Sonstige";
  const label = input.label.trim();
  if (!label) return;
  await getPool().query(
    "UPDATE insurance_documents SET category = ?, label = ?, note = ? WHERE id = ?",
    [category.slice(0, 120), label.slice(0, 255), input.note?.trim().slice(0, 2000) || null, id]
  );
}

/** Löscht ein Dokument (inkl. Datei). */
export async function deleteInsuranceDocument(id: number): Promise<void> {
  await ensureTable();
  const pool = getPool();
  const [rows] = await pool.query<DocRow[]>(
    "SELECT stored_name FROM insurance_documents WHERE id = ? LIMIT 1",
    [id]
  );
  const stored = rows[0]?.stored_name ?? null;
  await pool.query("DELETE FROM insurance_documents WHERE id = ?", [id]);
  if (stored) {
    try {
      await unlink(path.join(VERSICHERUNG_DIR, stored));
    } catch {
      /* Datei evtl. schon weg */
    }
  }
}

/** Lädt die Datei eines Dokuments zum Anzeigen/Herunterladen. */
export async function getInsuranceDocumentFile(
  id: number
): Promise<{ data: Buffer; mime: string; name: string } | null> {
  await ensureTable();
  const [rows] = await getPool().query<DocRow[]>(
    "SELECT file_name, stored_name, mime FROM insurance_documents WHERE id = ? LIMIT 1",
    [id]
  );
  const row = rows[0];
  if (!row?.stored_name) return null;
  try {
    const data = await readFile(path.join(VERSICHERUNG_DIR, row.stored_name));
    return { data, mime: row.mime ?? "application/octet-stream", name: row.file_name ?? "dokument" };
  } catch {
    return null;
  }
}
