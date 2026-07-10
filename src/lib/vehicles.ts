import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

/** Ablageordner für Fahrzeug-Unterlagen (konfigurierbar via FAHRZEUG_DIR). */
const FAHRZEUG_DIR = process.env.FAHRZEUG_DIR || path.join(process.cwd(), "data", "fahrzeuge");

export interface Vehicle {
  id: number;
  name: string;
  plate: string | null;
  note: string | null;
  docCount: number;
}

export interface VehicleDocument {
  id: number;
  vehicleId: number;
  label: string;
  fileName: string | null;
  mime: string | null;
  hasFile: boolean;
  uploadedByName: string | null;
  created: string | null;
}

interface VehicleRow extends RowDataPacket {
  id: number;
  name: string;
  plate: string | null;
  note: string | null;
  doc_count: number;
}

interface DocRow extends RowDataPacket {
  id: number;
  vehicle_id: number;
  label: string;
  file_name: string | null;
  stored_name: string | null;
  mime: string | null;
  uploaded_by_name: string | null;
  created: string | null;
}

/** Alle Fahrzeuge inkl. Anzahl hinterlegter Dokumente. */
export async function listVehicles(): Promise<Vehicle[]> {
  const [rows] = await getPool().query<VehicleRow[]>(
    `SELECT v.id, v.name, v.plate, v.note, COUNT(d.id) AS doc_count
     FROM vehicles v
     LEFT JOIN vehicle_documents d ON d.vehicle_id = v.id
     GROUP BY v.id, v.name, v.plate, v.note
     ORDER BY v.name`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    plate: r.plate,
    note: r.note,
    docCount: Number(r.doc_count),
  }));
}

export async function createVehicle(input: {
  name: string;
  plate: string | null;
  note: string | null;
}): Promise<number | null> {
  const name = input.name.trim();
  if (!name) return null;
  const [res] = await getPool().query(
    "INSERT INTO vehicles (name, plate, note) VALUES (?, ?, ?)",
    [name.slice(0, 191), input.plate?.trim().slice(0, 64) || null, input.note?.trim().slice(0, 5000) || null]
  );
  return (res as { insertId: number }).insertId;
}

export async function updateVehicle(input: {
  id: number;
  name: string;
  plate: string | null;
  note: string | null;
}): Promise<void> {
  const name = input.name.trim();
  if (!name) return;
  await getPool().query(
    "UPDATE vehicles SET name = ?, plate = ?, note = ? WHERE id = ?",
    [
      name.slice(0, 191),
      input.plate?.trim().slice(0, 64) || null,
      input.note?.trim().slice(0, 5000) || null,
      input.id,
    ]
  );
}

/** Speichert nur die Notiz eines Fahrzeugs. */
export async function updateVehicleNote(id: number, note: string | null): Promise<void> {
  await getPool().query("UPDATE vehicles SET note = ? WHERE id = ?", [
    note?.trim().slice(0, 5000) || null,
    id,
  ]);
}

/** Löscht ein Fahrzeug samt aller Dokumente (inkl. Dateien auf der Platte). */
export async function deleteVehicle(id: number): Promise<void> {
  const pool = getPool();
  const [docs] = await pool.query<DocRow[]>(
    "SELECT stored_name FROM vehicle_documents WHERE vehicle_id = ?",
    [id]
  );
  await pool.query("DELETE FROM vehicle_documents WHERE vehicle_id = ?", [id]);
  await pool.query("DELETE FROM vehicles WHERE id = ?", [id]);
  for (const d of docs) {
    if (d.stored_name) {
      try {
        await unlink(path.join(FAHRZEUG_DIR, d.stored_name));
      } catch {
        /* Datei evtl. schon weg */
      }
    }
  }
}

/** Dokumente eines Fahrzeugs (neueste zuerst). */
export async function listVehicleDocuments(vehicleId: number): Promise<VehicleDocument[]> {
  const [rows] = await getPool().query<DocRow[]>(
    `SELECT d.id, d.vehicle_id, d.label, d.file_name, d.stored_name, d.mime, d.created,
            COALESCE(NULLIF(u.display_name, ''), u.username) AS uploaded_by_name
     FROM vehicle_documents d
     LEFT JOIN users u ON u.id = d.uploaded_by
     WHERE d.vehicle_id = ?
     ORDER BY d.created DESC, d.id DESC`,
    [vehicleId]
  );
  return rows.map((r) => ({
    id: r.id,
    vehicleId: r.vehicle_id,
    label: r.label,
    fileName: r.file_name,
    mime: r.mime,
    hasFile: !!r.stored_name,
    uploadedByName: r.uploaded_by_name,
    created: r.created ? String(r.created) : null,
  }));
}

/** Legt ein Dokument (PDF/Bild) für ein Fahrzeug an. */
export async function addVehicleDocument(input: {
  vehicleId: number;
  label: string;
  file: { buffer: Buffer; originalName: string; mime: string };
  uploadedBy: number | null;
}): Promise<void> {
  await mkdir(FAHRZEUG_DIR, { recursive: true });
  const ext = path.extname(input.file.originalName) || "";
  const storedName = `${randomUUID()}${ext}`;
  await writeFile(path.join(FAHRZEUG_DIR, storedName), input.file.buffer);
  const label = input.label.trim() || input.file.originalName;
  await getPool().query(
    `INSERT INTO vehicle_documents (vehicle_id, label, file_name, stored_name, mime, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [input.vehicleId, label.slice(0, 255), input.file.originalName, storedName, input.file.mime, input.uploadedBy]
  );
}

/** Ändert nur die Beschriftung eines Dokuments. */
export async function updateVehicleDocumentLabel(id: number, label: string): Promise<void> {
  const clean = label.trim();
  if (!clean) return;
  await getPool().query("UPDATE vehicle_documents SET label = ? WHERE id = ?", [clean.slice(0, 255), id]);
}

/** Löscht ein Dokument (inkl. Datei). */
export async function deleteVehicleDocument(id: number): Promise<void> {
  const pool = getPool();
  const [rows] = await pool.query<DocRow[]>(
    "SELECT stored_name FROM vehicle_documents WHERE id = ? LIMIT 1",
    [id]
  );
  const stored = rows[0]?.stored_name ?? null;
  await pool.query("DELETE FROM vehicle_documents WHERE id = ?", [id]);
  if (stored) {
    try {
      await unlink(path.join(FAHRZEUG_DIR, stored));
    } catch {
      /* Datei evtl. schon weg */
    }
  }
}

/** Lädt die Datei eines Dokuments zum Anzeigen/Herunterladen. */
export async function getVehicleDocumentFile(
  id: number
): Promise<{ data: Buffer; mime: string; name: string } | null> {
  const [rows] = await getPool().query<DocRow[]>(
    "SELECT file_name, stored_name, mime FROM vehicle_documents WHERE id = ? LIMIT 1",
    [id]
  );
  const row = rows[0];
  if (!row?.stored_name) return null;
  try {
    const data = await readFile(path.join(FAHRZEUG_DIR, row.stored_name));
    return { data, mime: row.mime ?? "application/octet-stream", name: row.file_name ?? "dokument" };
  } catch {
    return null;
  }
}
