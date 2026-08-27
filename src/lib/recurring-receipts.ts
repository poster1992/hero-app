import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";
import { createManualReceipt } from "./manual-receipts";

/**
 * Wiederkehrende Belege (Vorlagen): feste monatliche Beträge (Miete, Leasing,
 * Versicherungen …), die per Knopfdruck als dateilose Belege für einen Monat
 * erzeugt werden. Dublettenschutz je Monat über manual_receipts.recurring_id/
 * recurring_month.
 */

export interface RecurringTemplate {
  id: number;
  supplier: string | null;
  description: string | null;
  gross: number;
  vatRate: number | null;
  accountNumber: string | null;
  accountName: string | null;
  dayOfMonth: number;
  active: boolean;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

let tableReady = false;
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  const pool = getPool();
  await pool
    .query(
      `CREATE TABLE IF NOT EXISTS recurring_receipts (
         id INT AUTO_INCREMENT PRIMARY KEY,
         supplier VARCHAR(255) NULL,
         description VARCHAR(500) NULL,
         gross DECIMAL(12,2) NOT NULL,
         vat_rate DECIMAL(5,2) NULL,
         account_number VARCHAR(50) NULL,
         account_name VARCHAR(255) NULL,
         day_of_month TINYINT NOT NULL DEFAULT 1,
         active TINYINT NOT NULL DEFAULT 1,
         created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    )
    .catch(() => {});
  // Dublettenschutz-Spalten an manual_receipts (MariaDB: IF NOT EXISTS).
  await pool
    .query("ALTER TABLE manual_receipts ADD COLUMN IF NOT EXISTS recurring_id INT NULL")
    .catch(() => {});
  await pool
    .query("ALTER TABLE manual_receipts ADD COLUMN IF NOT EXISTS recurring_month VARCHAR(7) NULL")
    .catch(() => {});
  tableReady = true;
}

interface TplRow extends RowDataPacket {
  id: number;
  supplier: string | null;
  description: string | null;
  gross: string | number;
  vat_rate: string | number | null;
  account_number: string | null;
  account_name: string | null;
  day_of_month: number;
  active: number;
}

function mapRow(r: TplRow): RecurringTemplate {
  return {
    id: r.id,
    supplier: r.supplier,
    description: r.description,
    gross: num(r.gross),
    vatRate: r.vat_rate == null ? null : num(r.vat_rate),
    accountNumber: r.account_number,
    accountName: r.account_name,
    dayOfMonth: Number(r.day_of_month) || 1,
    active: !!r.active,
  };
}

/** Alle Vorlagen (aktive zuerst, dann nach Lieferant). */
export async function listRecurring(): Promise<RecurringTemplate[]> {
  await ensureTable();
  const [rows] = await getPool().query<TplRow[]>(
    `SELECT id, supplier, description, gross, vat_rate, account_number, account_name, day_of_month, active
     FROM recurring_receipts
     ORDER BY active DESC, supplier ASC, id ASC`
  );
  return rows.map(mapRow);
}

export interface RecurringInput {
  supplier: string | null;
  description: string | null;
  gross: number;
  vatRate: number | null;
  accountNumber: string | null;
  accountName: string | null;
  dayOfMonth: number;
  active: boolean;
}

const clampDay = (d: number) => Math.min(31, Math.max(1, Math.round(d) || 1));

export async function createRecurring(input: RecurringInput): Promise<number> {
  await ensureTable();
  const [res] = await getPool().query(
    `INSERT INTO recurring_receipts
       (supplier, description, gross, vat_rate, account_number, account_name, day_of_month, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.supplier?.trim().slice(0, 255) || null,
      input.description?.trim().slice(0, 500) || null,
      input.gross,
      input.vatRate,
      input.accountNumber?.trim().slice(0, 50) || null,
      input.accountName?.trim().slice(0, 255) || null,
      clampDay(input.dayOfMonth),
      input.active ? 1 : 0,
    ]
  );
  return (res as { insertId: number }).insertId;
}

export async function updateRecurring(id: number, input: RecurringInput): Promise<void> {
  await ensureTable();
  await getPool().query(
    `UPDATE recurring_receipts
       SET supplier = ?, description = ?, gross = ?, vat_rate = ?, account_number = ?, account_name = ?,
           day_of_month = ?, active = ?
     WHERE id = ?`,
    [
      input.supplier?.trim().slice(0, 255) || null,
      input.description?.trim().slice(0, 500) || null,
      input.gross,
      input.vatRate,
      input.accountNumber?.trim().slice(0, 50) || null,
      input.accountName?.trim().slice(0, 255) || null,
      clampDay(input.dayOfMonth),
      input.active ? 1 : 0,
      id,
    ]
  );
}

export async function setRecurringActive(id: number, active: boolean): Promise<void> {
  await ensureTable();
  await getPool().query("UPDATE recurring_receipts SET active = ? WHERE id = ?", [active ? 1 : 0, id]);
}

export async function deleteRecurring(id: number): Promise<void> {
  await ensureTable();
  await getPool().query("DELETE FROM recurring_receipts WHERE id = ?", [id]);
}

export interface GenerateResult {
  created: number;
  skipped: number;
  createdNames: string[];
}

/**
 * Erzeugt für den Monat (year, 1-basiertem month) je aktiver Vorlage einen
 * dateilosen Beleg – überspringt Vorlagen, die für diesen Monat schon erzeugt
 * wurden (Dublettenschutz über recurring_id + recurring_month).
 */
export async function generateForMonth(
  year: number,
  month: number,
  uploadedBy: number | null
): Promise<GenerateResult> {
  await ensureTable();
  const pool = getPool();
  const period = `${year}-${String(month).padStart(2, "0")}`;
  const lastDay = new Date(year, month, 0).getDate(); // month ist 1-basiert → Tag 0 des Folgemonats
  const templates = (await listRecurring()).filter((t) => t.active);

  let created = 0;
  let skipped = 0;
  const createdNames: string[] = [];

  for (const t of templates) {
    const [ex] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM manual_receipts WHERE recurring_id = ? AND recurring_month = ? LIMIT 1",
      [t.id, period]
    );
    if (ex.length > 0) {
      skipped++;
      continue;
    }
    const day = Math.min(t.dayOfMonth, lastDay);
    const date = `${period}-${String(day).padStart(2, "0")}`;
    const receiptId = await createManualReceipt({
      date,
      supplier: t.supplier,
      description: t.description,
      gross: t.gross,
      vatRate: t.vatRate,
      accountNumber: t.accountNumber,
      accountName: t.accountName,
      file: null,
      uploadedBy,
      source: "recurring",
    });
    await pool.query("UPDATE manual_receipts SET recurring_id = ?, recurring_month = ? WHERE id = ?", [
      t.id,
      period,
      receiptId,
    ]);
    created++;
    createdNames.push(t.supplier || t.description || `Vorlage #${t.id}`);
  }

  return { created, skipped, createdNames };
}
