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
  /** Zugewiesener Mitarbeiter/Fahrer (wer fährt das Fahrzeug). */
  driver: string | null;
  note: string | null;
  docCount: number;
  /** Monatliche Leasingrate in EUR, falls geleast. */
  leasingRate: number | null;
  /** Einmalige Restrate (Schlussrate) nach Laufzeitende, falls vereinbart. */
  leasingFinalRate: number | null;
  /** true, sobald die Restrate als bezahlt markiert wurde. */
  leasingFinalPaid: boolean;
  leasingFinalPaidDate: string | null;
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
  driver: string | null;
  note: string | null;
  doc_count: number;
  leasing_rate: string | number | null;
  leasing_final_rate: string | number | null;
  leasing_final_paid: number | null;
  leasing_final_paid_date: string | null;
}

/**
 * Self-healing: Leasing-Spalten auf `vehicles` nachrüsten (monatliche Rate,
 * einmalige Restrate nach Laufzeitende + deren Bezahlt-Status).
 */
let leasingColumnsReady = false;
async function ensureLeasingColumns(): Promise<void> {
  if (leasingColumnsReady) return;
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vehicles'
        AND COLUMN_NAME IN ('leasing_rate', 'leasing_final_rate', 'leasing_final_paid', 'leasing_final_paid_date')`
  );
  const existing = new Set(rows.map((r) => String(r.COLUMN_NAME)));
  if (!existing.has("leasing_rate")) {
    await pool.query("ALTER TABLE vehicles ADD COLUMN leasing_rate DECIMAL(10,2) NULL").catch(() => {});
  }
  if (!existing.has("leasing_final_rate")) {
    await pool.query("ALTER TABLE vehicles ADD COLUMN leasing_final_rate DECIMAL(10,2) NULL").catch(() => {});
  }
  if (!existing.has("leasing_final_paid")) {
    await pool.query("ALTER TABLE vehicles ADD COLUMN leasing_final_paid TINYINT NOT NULL DEFAULT 0").catch(() => {});
  }
  if (!existing.has("leasing_final_paid_date")) {
    await pool.query("ALTER TABLE vehicles ADD COLUMN leasing_final_paid_date DATE NULL").catch(() => {});
  }
  leasingColumnsReady = true;
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
  await ensureLeasingColumns();
  const [rows] = await getPool().query<VehicleRow[]>(
    `SELECT v.id, v.name, v.plate, v.driver, v.note,
            v.leasing_rate, v.leasing_final_rate, v.leasing_final_paid, v.leasing_final_paid_date,
            COUNT(d.id) AS doc_count
     FROM vehicles v
     LEFT JOIN vehicle_documents d ON d.vehicle_id = v.id
     GROUP BY v.id, v.name, v.plate, v.driver, v.note,
              v.leasing_rate, v.leasing_final_rate, v.leasing_final_paid, v.leasing_final_paid_date
     ORDER BY v.name`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    plate: r.plate,
    driver: r.driver,
    note: r.note,
    docCount: Number(r.doc_count),
    leasingRate: r.leasing_rate != null ? Number(r.leasing_rate) : null,
    leasingFinalRate: r.leasing_final_rate != null ? Number(r.leasing_final_rate) : null,
    leasingFinalPaid: Number(r.leasing_final_paid) === 1,
    leasingFinalPaidDate: r.leasing_final_paid_date ? String(r.leasing_final_paid_date).slice(0, 10) : null,
  }));
}

export async function createVehicle(input: {
  name: string;
  plate: string | null;
  driver: string | null;
  note: string | null;
  leasingRate?: number | null;
  leasingFinalRate?: number | null;
}): Promise<number | null> {
  await ensureLeasingColumns();
  const name = input.name.trim();
  if (!name) return null;
  const [res] = await getPool().query(
    "INSERT INTO vehicles (name, plate, driver, note, leasing_rate, leasing_final_rate) VALUES (?, ?, ?, ?, ?, ?)",
    [
      name.slice(0, 191),
      input.plate?.trim().slice(0, 64) || null,
      input.driver?.trim().slice(0, 191) || null,
      input.note?.trim().slice(0, 5000) || null,
      input.leasingRate ?? null,
      input.leasingFinalRate ?? null,
    ]
  );
  return (res as { insertId: number }).insertId;
}

export async function updateVehicle(input: {
  id: number;
  name: string;
  plate: string | null;
  driver: string | null;
  note: string | null;
  leasingRate?: number | null;
  leasingFinalRate?: number | null;
}): Promise<void> {
  await ensureLeasingColumns();
  const name = input.name.trim();
  if (!name) return;
  await getPool().query(
    "UPDATE vehicles SET name = ?, plate = ?, driver = ?, note = ?, leasing_rate = ?, leasing_final_rate = ? WHERE id = ?",
    [
      name.slice(0, 191),
      input.plate?.trim().slice(0, 64) || null,
      input.driver?.trim().slice(0, 191) || null,
      input.note?.trim().slice(0, 5000) || null,
      input.leasingRate ?? null,
      input.leasingFinalRate ?? null,
      input.id,
    ]
  );
}

/** Markiert/entmarkiert die einmalige Restrate (Schlussrate) eines Fahrzeugs als bezahlt. */
export async function setVehicleLeasingFinalPaid(id: number, paid: boolean): Promise<void> {
  await ensureLeasingColumns();
  await getPool().query(
    `UPDATE vehicles SET leasing_final_paid = ?, leasing_final_paid_date = ${paid ? "CURDATE()" : "NULL"} WHERE id = ?`,
    [paid ? 1 : 0, id]
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

// ---------------------------------------------------------------------------
// Fahrzeug-Leasing: monatlicher Bezahlt/läuft-noch-Status je Fahrzeug + Monat.
// ---------------------------------------------------------------------------

export interface VehicleLeasingMonth {
  paid: boolean;
  paidDate: string | null;
  paidByName: string | null;
}

interface LeasingPaymentRow extends RowDataPacket {
  vehicle_id: number;
  is_paid: number;
  paid_date: string | null;
  paid_by_name: string | null;
}

let leasingPaymentsTableReady = false;
async function ensureLeasingPaymentsTable(): Promise<void> {
  if (leasingPaymentsTableReady) return;
  await getPool()
    .query(
      `CREATE TABLE IF NOT EXISTS vehicle_leasing_payments (
         id INT AUTO_INCREMENT PRIMARY KEY,
         vehicle_id INT NOT NULL,
         year INT NOT NULL,
         month INT NOT NULL,
         is_paid TINYINT NOT NULL DEFAULT 0,
         paid_date DATE NULL,
         paid_by INT NULL,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         UNIQUE KEY uq_vlp_vehicle_period (vehicle_id, year, month),
         INDEX idx_vlp_period (year, month)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    )
    .catch(() => {});
  leasingPaymentsTableReady = true;
}

/** Bezahlt-Status aller Fahrzeuge für einen Monat (keyed nach Fahrzeug-ID). */
export async function listLeasingMonthStatus(year: number, month: number): Promise<Map<number, VehicleLeasingMonth>> {
  await ensureLeasingPaymentsTable();
  const [rows] = await getPool().query<LeasingPaymentRow[]>(
    `SELECT p.vehicle_id, p.is_paid, p.paid_date,
            COALESCE(NULLIF(u.display_name, ''), u.username) AS paid_by_name
     FROM vehicle_leasing_payments p
     LEFT JOIN users u ON u.id = p.paid_by
     WHERE p.year = ? AND p.month = ?`,
    [year, month]
  );
  const map = new Map<number, VehicleLeasingMonth>();
  for (const r of rows) {
    map.set(r.vehicle_id, {
      paid: Number(r.is_paid) === 1,
      paidDate: r.paid_date ? String(r.paid_date).slice(0, 10) : null,
      paidByName: r.paid_by_name,
    });
  }
  return map;
}

/** Setzt/entfernt den Bezahlt-Status eines Fahrzeugs für einen bestimmten Monat. */
export async function setLeasingMonthPaid(
  vehicleId: number,
  year: number,
  month: number,
  paid: boolean,
  userId: number | null
): Promise<void> {
  await ensureLeasingPaymentsTable();
  await getPool().query(
    `INSERT INTO vehicle_leasing_payments (vehicle_id, year, month, is_paid, paid_date, paid_by)
     VALUES (?, ?, ?, ?, ${paid ? "CURDATE()" : "NULL"}, ?)
     ON DUPLICATE KEY UPDATE is_paid = VALUES(is_paid), paid_date = VALUES(paid_date), paid_by = VALUES(paid_by)`,
    [vehicleId, year, month, paid ? 1 : 0, paid ? userId : null]
  );
}
