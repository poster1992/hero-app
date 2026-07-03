import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { getPool } from "./db";
import { listLohnEmployees } from "./lohn-employees";

// Krankmeldungen liegen im selben persistenten Volume wie die Belege (Unterordner).
const BELEGE_DIR = process.env.BELEGE_DIR || path.join(process.cwd(), "data", "belege");
const KRANK_DIR = process.env.KRANKMELDUNGEN_DIR || path.join(BELEGE_DIR, "krankmeldungen");

export interface KrankmeldungFile {
  id: number;
  fileName: string;
  mime: string | null;
}

/** Eine Zeile der monatlichen Übersicht (je Mitarbeiter aus der Abschlagsliste). */
export interface MonthlyOverviewRow {
  employeeId: number;
  name: string;
  krank: string;
  krankGesamt: string;
  urlaub: string;
  urlaubGesamt: string;
  ueberstunden: string;
  elternzeit: string;
  krankmeldungen: KrankmeldungFile[];
}

interface OverviewRow extends RowDataPacket {
  employee_id: number;
  krank: string | null;
  krank_gesamt: string | null;
  urlaub: string | null;
  urlaub_gesamt: string | null;
  ueberstunden: string | null;
  elternzeit: string | null;
}

interface KrankRow extends RowDataPacket {
  id: number;
  employee_id: number;
  file_name: string;
  mime: string | null;
}

/**
 * Baut die Monatsübersicht: eine Zeile je aktivem Mitarbeiter der Abschlagsliste,
 * vorbelegt mit gespeicherten Werten und angehängten Krankmeldungen.
 */
export async function getMonthlyOverview(year: number, month: number): Promise<MonthlyOverviewRow[]> {
  const employees = await listLohnEmployees(false); // nur aktive
  const pool = getPool();

  const [saved] = await pool.query<OverviewRow[]>(
    `SELECT employee_id, krank, krank_gesamt, urlaub, urlaub_gesamt, ueberstunden, elternzeit
       FROM monthly_overview WHERE year = ? AND month = ?`,
    [year, month]
  );
  const savedMap = new Map(saved.map((r) => [r.employee_id, r]));

  const [files] = await pool.query<KrankRow[]>(
    `SELECT id, employee_id, file_name, mime FROM krankmeldungen
      WHERE year = ? AND month = ? ORDER BY id ASC`,
    [year, month]
  );
  const filesMap = new Map<number, KrankmeldungFile[]>();
  for (const f of files) {
    (filesMap.get(f.employee_id) ?? filesMap.set(f.employee_id, []).get(f.employee_id)!).push({
      id: f.id,
      fileName: f.file_name,
      mime: f.mime,
    });
  }

  return employees.map((e) => {
    const s = savedMap.get(e.id);
    return {
      employeeId: e.id,
      name: e.name,
      krank: s?.krank ?? "",
      krankGesamt: s?.krank_gesamt ?? "",
      urlaub: s?.urlaub ?? "",
      urlaubGesamt: s?.urlaub_gesamt ?? "",
      ueberstunden: s?.ueberstunden ?? "",
      elternzeit: s?.elternzeit ?? "",
      krankmeldungen: filesMap.get(e.id) ?? [],
    };
  });
}

export type MonthlyField =
  | "krank"
  | "krank_gesamt"
  | "urlaub"
  | "urlaub_gesamt"
  | "ueberstunden"
  | "elternzeit";

const FIELD_COLUMNS: Record<MonthlyField, string> = {
  krank: "krank",
  krank_gesamt: "krank_gesamt",
  urlaub: "urlaub",
  urlaub_gesamt: "urlaub_gesamt",
  ueberstunden: "ueberstunden",
  elternzeit: "elternzeit",
};

/** Speichert einen einzelnen Feldwert (Upsert je Mitarbeiter/Monat). */
export async function saveMonthlyField(
  year: number,
  month: number,
  employeeId: number,
  field: MonthlyField,
  value: string
): Promise<void> {
  const col = FIELD_COLUMNS[field];
  if (!col) return;
  const val = value.trim().slice(0, 255) || null;
  await getPool().query(
    `INSERT INTO monthly_overview (year, month, employee_id, ${col})
       VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE ${col} = VALUES(${col})`,
    [year, month, employeeId, val]
  );
}

/** Hängt eine Krankmeldung (Datei) an einen Mitarbeiter/Monat an. */
export async function addKrankmeldung(
  year: number,
  month: number,
  employeeId: number,
  file: { buffer: Buffer; originalName: string; mime: string },
  uploadedBy: number | null
): Promise<void> {
  await mkdir(KRANK_DIR, { recursive: true });
  const ext = path.extname(file.originalName) || "";
  const storedName = `${randomUUID()}${ext}`;
  await writeFile(path.join(KRANK_DIR, storedName), file.buffer);
  await getPool().query<ResultSetHeader>(
    `INSERT INTO krankmeldungen (year, month, employee_id, file_name, stored_name, mime, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [year, month, employeeId, file.originalName.slice(0, 255), storedName, file.mime, uploadedBy]
  );
}

/** Liefert eine Krankmeldungs-Datei zum Anzeigen/Download. */
export async function getKrankmeldungFile(
  id: number
): Promise<{ data: Buffer; mime: string; name: string } | null> {
  const [rows] = await getPool().query<KrankRow[] & { stored_name: string }[]>(
    "SELECT file_name, stored_name, mime FROM krankmeldungen WHERE id = ? LIMIT 1",
    [id]
  );
  const row = rows[0] as (KrankRow & { stored_name: string }) | undefined;
  if (!row) return null;
  try {
    const data = await readFile(path.join(KRANK_DIR, row.stored_name));
    return { data, mime: row.mime || "application/octet-stream", name: row.file_name };
  } catch {
    return null;
  }
}

/** Entfernt eine Krankmeldung (DB-Eintrag + Datei). */
export async function deleteKrankmeldung(id: number): Promise<void> {
  const pool = getPool();
  const [rows] = await pool.query<(KrankRow & { stored_name: string })[]>(
    "SELECT stored_name FROM krankmeldungen WHERE id = ? LIMIT 1",
    [id]
  );
  const stored = rows[0]?.stored_name ?? null;
  await pool.query("DELETE FROM krankmeldungen WHERE id = ?", [id]);
  if (stored) {
    try {
      await unlink(path.join(KRANK_DIR, stored));
    } catch {
      // Datei evtl. schon weg – ignorieren.
    }
  }
}
