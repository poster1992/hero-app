import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

/** Directory for uploaded receipt files (configurable via BELEGE_DIR). */
const BELEGE_DIR = process.env.BELEGE_DIR || path.join(process.cwd(), "data", "belege");

export interface ManualReceipt {
  id: number;
  date: string | null;
  supplier: string | null;
  description: string | null;
  gross: number;
  vatRate: number | null;
  net: number;
  vat: number;
  accountNumber: string | null;
  accountName: string | null;
  fileName: string | null;
  mime: string | null;
  hasFile: boolean;
  isPaid: boolean;
  paidDate: string | null;
  /** Optional zugeordnetes Projekt (HERO project_match id). */
  projectId: number | null;
  projectRelativeId: number | null;
  projectName: string | null;
  /** Belegnummer des Lieferanten (z. B. Rechnungsnummer). */
  invoiceNumber: string | null;
  /** Skontobetrag in EUR. */
  skontoAmount: number | null;
  /** Zu zahlender Betrag bei Skontoabzug (Skontozahlbetrag). */
  skontoPayAmount: number | null;
  /** Skontozahlungsziel (Datum, bis zu dem der Skonto gilt). */
  skontoDueDate: string | null;
}

interface ReceiptRow extends RowDataPacket {
  id: number;
  beleg_date: string | null;
  supplier: string | null;
  description: string | null;
  gross: string | number;
  vat_rate: string | number | null;
  account_number: string | null;
  account_name: string | null;
  file_name: string | null;
  stored_name: string | null;
  mime: string | null;
  is_paid: number | null;
  paid_date: string | null;
  project_id: number | null;
  project_relative_id: number | null;
  project_name: string | null;
  invoice_number: string | null;
  skonto_amount: string | number | null;
  skonto_pay_amount: string | number | null;
  skonto_due_date: string | null;
}

const num = (v: string | number | null): number => (v == null ? 0 : Number(v));

function mapRow(r: ReceiptRow): ManualReceipt {
  const gross = num(r.gross);
  const rate = r.vat_rate == null ? null : num(r.vat_rate);
  const vat = rate ? Math.round((gross - gross / (1 + rate / 100)) * 100) / 100 : 0;
  return {
    id: r.id,
    date: r.beleg_date ? String(r.beleg_date).slice(0, 10) : null,
    supplier: r.supplier,
    description: r.description,
    gross,
    vatRate: rate,
    net: Math.round((gross - vat) * 100) / 100,
    vat,
    accountNumber: r.account_number,
    accountName: r.account_name,
    fileName: r.file_name,
    mime: r.mime,
    hasFile: !!r.stored_name,
    isPaid: r.is_paid === 1,
    paidDate: r.paid_date ? String(r.paid_date).slice(0, 10) : null,
    projectId: r.project_id ?? null,
    projectRelativeId: r.project_relative_id ?? null,
    projectName: r.project_name ?? null,
    invoiceNumber: r.invoice_number ?? null,
    skontoAmount: r.skonto_amount == null ? null : num(r.skonto_amount),
    skontoPayAmount: r.skonto_pay_amount == null ? null : num(r.skonto_pay_amount),
    skontoDueDate: r.skonto_due_date ? String(r.skonto_due_date).slice(0, 10) : null,
  };
}

/** Manual receipts whose beleg_date falls in the given year (newest first). */
export async function listManualReceipts(year: number): Promise<ManualReceipt[]> {
  const [rows] = await getPool().query<ReceiptRow[]>(
    `SELECT id, beleg_date, supplier, description, gross, vat_rate, account_number, account_name,
            file_name, stored_name, mime, is_paid, paid_date, project_id, project_relative_id, project_name,
            invoice_number, skonto_amount, skonto_pay_amount, skonto_due_date
     FROM manual_receipts
     WHERE beleg_date IS NULL OR YEAR(beleg_date) = ?
     ORDER BY beleg_date DESC, id DESC`,
    [year]
  );
  return rows.map(mapRow);
}

/** Loads a single manual receipt by id (or null). */
export async function getManualReceipt(id: number): Promise<ManualReceipt | null> {
  const [rows] = await getPool().query<ReceiptRow[]>(
    `SELECT id, beleg_date, supplier, description, gross, vat_rate, account_number, account_name,
            file_name, stored_name, mime, is_paid, paid_date, project_id, project_relative_id, project_name,
            invoice_number, skonto_amount, skonto_pay_amount, skonto_due_date
     FROM manual_receipts WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/** Sets/clears the paid status of a manual receipt. */
export async function setManualReceiptPaid(id: number, paid: boolean): Promise<void> {
  await getPool().query(
    "UPDATE manual_receipts SET is_paid = ?, paid_date = ? WHERE id = ?",
    [paid ? 1 : 0, paid ? new Date().toISOString().slice(0, 10) : null, id]
  );
}

export async function createManualReceipt(input: {
  date: string | null;
  supplier: string | null;
  description: string | null;
  gross: number;
  vatRate: number | null;
  accountNumber: string | null;
  accountName: string | null;
  file: { buffer: Buffer; originalName: string; mime: string } | null;
  uploadedBy: number | null;
  /** Herkunft: "form" (Formular) oder "inbox" (Sammel-Posteingang). */
  source?: string;
  projectId?: number | null;
  projectRelativeId?: number | null;
  projectName?: string | null;
  invoiceNumber?: string | null;
  skontoAmount?: number | null;
  skontoPayAmount?: number | null;
  skontoDueDate?: string | null;
}): Promise<number> {
  let storedName: string | null = null;
  if (input.file) {
    await mkdir(BELEGE_DIR, { recursive: true });
    const ext = path.extname(input.file.originalName) || "";
    storedName = `${randomUUID()}${ext}`;
    await writeFile(path.join(BELEGE_DIR, storedName), input.file.buffer);
  }
  const [res] = await getPool().query(
    `INSERT INTO manual_receipts
       (beleg_date, supplier, description, gross, vat_rate, account_number, account_name, file_name, stored_name, mime, uploaded_by, source, project_id, project_relative_id, project_name, invoice_number, skonto_amount, skonto_pay_amount, skonto_due_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.date,
      input.supplier,
      input.description,
      input.gross,
      input.vatRate,
      input.accountNumber,
      input.accountName,
      input.file?.originalName ?? null,
      storedName,
      input.file?.mime ?? null,
      input.uploadedBy,
      input.source ?? "form",
      input.projectId ?? null,
      input.projectRelativeId ?? null,
      input.projectName ?? null,
      input.invoiceNumber ?? null,
      input.skontoAmount ?? null,
      input.skontoPayAmount ?? null,
      input.skontoDueDate ?? null,
    ]
  );
  return (res as { insertId: number }).insertId;
}

export interface InboxReceipt {
  id: number;
  /** Belegdatum (yyyy-mm-dd) oder null. */
  date: string | null;
  /** Erfassungszeitpunkt (ISO), für die Workflow-Auslösung. */
  created: string | null;
  supplier: string | null;
  description: string | null;
  gross: number;
}

/** Im Posteingang (source='inbox') erfasste Belege – für die Workflow-Auslösung. */
export async function listInboxReceipts(): Promise<InboxReceipt[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT id, beleg_date, created, supplier, description, gross
     FROM manual_receipts WHERE source = 'inbox' ORDER BY id DESC`
  );
  return (rows as {
    id: number;
    beleg_date: string | Date | null;
    created: string | Date | null;
    supplier: string | null;
    description: string | null;
    gross: string | number;
  }[]).map((r) => ({
    id: r.id,
    date: r.beleg_date ? String(r.beleg_date).slice(0, 10) : null,
    created: r.created ? String(r.created) : null,
    supplier: r.supplier,
    description: r.description,
    gross: num(r.gross),
  }));
}

/** Updates an existing manual receipt; replaces the file only if a new one is given. */
export async function updateManualReceipt(input: {
  id: number;
  date: string | null;
  supplier: string | null;
  description: string | null;
  gross: number;
  vatRate: number | null;
  accountNumber: string | null;
  accountName: string | null;
  file: { buffer: Buffer; originalName: string; mime: string } | null;
  projectId?: number | null;
  projectRelativeId?: number | null;
  projectName?: string | null;
  invoiceNumber?: string | null;
  skontoAmount?: number | null;
  skontoPayAmount?: number | null;
  skontoDueDate?: string | null;
}): Promise<void> {
  const pool = getPool();
  const projectId = input.projectId ?? null;
  const projectRelativeId = input.projectRelativeId ?? null;
  const projectName = input.projectName ?? null;
  const invoiceNumber = input.invoiceNumber ?? null;
  const skontoAmount = input.skontoAmount ?? null;
  const skontoPayAmount = input.skontoPayAmount ?? null;
  const skontoDueDate = input.skontoDueDate ?? null;

  if (input.file) {
    // Alte Datei merken, um sie nach dem Ersetzen zu entfernen.
    const [rows] = await pool.query<ReceiptRow[]>(
      "SELECT stored_name FROM manual_receipts WHERE id = ? LIMIT 1",
      [input.id]
    );
    const oldStored = rows[0]?.stored_name ?? null;

    await mkdir(BELEGE_DIR, { recursive: true });
    const ext = path.extname(input.file.originalName) || "";
    const storedName = `${randomUUID()}${ext}`;
    await writeFile(path.join(BELEGE_DIR, storedName), input.file.buffer);

    await pool.query(
      `UPDATE manual_receipts
         SET beleg_date = ?, supplier = ?, description = ?, gross = ?, vat_rate = ?,
             account_number = ?, account_name = ?, file_name = ?, stored_name = ?, mime = ?,
             project_id = ?, project_relative_id = ?, project_name = ?,
             invoice_number = ?, skonto_amount = ?, skonto_pay_amount = ?, skonto_due_date = ?
       WHERE id = ?`,
      [
        input.date,
        input.supplier,
        input.description,
        input.gross,
        input.vatRate,
        input.accountNumber,
        input.accountName,
        input.file.originalName,
        storedName,
        input.file.mime,
        projectId,
        projectRelativeId,
        projectName,
        invoiceNumber,
        skontoAmount,
        skontoPayAmount,
        skontoDueDate,
        input.id,
      ]
    );

    if (oldStored) {
      try {
        await unlink(path.join(BELEGE_DIR, oldStored));
      } catch {
        // Alte Datei evtl. schon weg – ignorieren.
      }
    }
    return;
  }

  await pool.query(
    `UPDATE manual_receipts
       SET beleg_date = ?, supplier = ?, description = ?, gross = ?, vat_rate = ?,
           account_number = ?, account_name = ?,
           project_id = ?, project_relative_id = ?, project_name = ?,
           invoice_number = ?, skonto_amount = ?, skonto_pay_amount = ?, skonto_due_date = ?
     WHERE id = ?`,
    [
      input.date,
      input.supplier,
      input.description,
      input.gross,
      input.vatRate,
      input.accountNumber,
      input.accountName,
      projectId,
      projectRelativeId,
      projectName,
      invoiceNumber,
      skontoAmount,
      skontoPayAmount,
      skontoDueDate,
      input.id,
    ]
  );
}

/** Löscht einen manuellen Beleg samt hinterlegter Datei. */
export async function deleteManualReceipt(id: number): Promise<void> {
  const pool = getPool();
  const [rows] = await pool.query<ReceiptRow[]>(
    "SELECT stored_name FROM manual_receipts WHERE id = ? LIMIT 1",
    [id]
  );
  const stored = rows[0]?.stored_name ?? null;
  await pool.query("DELETE FROM manual_receipts WHERE id = ?", [id]);
  if (stored) {
    try {
      await unlink(path.join(BELEGE_DIR, stored));
    } catch {
      // Datei evtl. schon weg – ignorieren.
    }
  }
}

/** IDs manueller Belege mit Datei, aber noch ohne OCR-Volltext (für die Indexierung). */
export async function listManualReceiptIdsNeedingOcr(): Promise<number[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT id FROM manual_receipts WHERE stored_name IS NOT NULL AND (ocr_text IS NULL OR ocr_text = '')"
  );
  return (rows as { id: number }[]).map((r) => r.id);
}

/** Speichert den OCR-Volltext eines manuellen Belegs. */
export async function setManualReceiptOcrText(id: number, text: string | null): Promise<void> {
  await getPool().query("UPDATE manual_receipts SET ocr_text = ? WHERE id = ?", [
    text ? text.slice(0, 16_000_000) : null,
    id,
  ]);
}

/** Status der OCR-Indexierung: wie viele Belege mit Datei sind volltext-indexiert. */
export async function getManualOcrStatus(): Promise<{ total: number; done: number }> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT
       SUM(stored_name IS NOT NULL) AS total,
       SUM(stored_name IS NOT NULL AND ocr_text IS NOT NULL AND ocr_text <> '') AS done
     FROM manual_receipts`
  );
  const r = (rows as { total: number | null; done: number | null }[])[0];
  return { total: Number(r?.total ?? 0), done: Number(r?.done ?? 0) };
}

/** Volltextsuche über die manuellen Belege → Menge passender Beleg-IDs. */
export async function searchManualOcrIds(query: string): Promise<Set<number>> {
  const q = query.trim();
  if (!q) return new Set();
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT id FROM manual_receipts WHERE ocr_text LIKE ? LIMIT 5000",
    [`%${q}%`]
  );
  return new Set((rows as { id: number }[]).map((r) => r.id));
}

/** Manuelle Belege (mit Datei), die einem Projekt zugeordnet sind. */
export async function listManualReceiptsByProject(
  projectId: number
): Promise<{ id: number; supplier: string | null; storedName: string | null }[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT id, supplier, stored_name FROM manual_receipts WHERE project_id = ?",
    [projectId]
  );
  return (rows as { id: number; supplier: string | null; stored_name: string | null }[]).map((r) => ({
    id: r.id,
    supplier: r.supplier,
    storedName: r.stored_name,
  }));
}

/** Loads a receipt's stored file for download/inline view. */
export async function getManualReceiptFile(
  id: number
): Promise<{ data: Buffer; mime: string; name: string } | null> {
  const [rows] = await getPool().query<ReceiptRow[]>(
    "SELECT file_name, stored_name, mime FROM manual_receipts WHERE id = ? LIMIT 1",
    [id]
  );
  const row = rows[0];
  if (!row?.stored_name) return null;
  try {
    const data = await readFile(path.join(BELEGE_DIR, row.stored_name));
    return { data, mime: row.mime ?? "application/octet-stream", name: row.file_name ?? "beleg" };
  } catch {
    return null;
  }
}
