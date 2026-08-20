import "server-only";
import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

export interface SupplierFingerprint {
  id: number;
  keyword: string;
  supplierName: string;
  accountNumber: string | null;
  accountName: string | null;
}

let tableReady = false;
/** Stellt die Tabelle sicher (einmalig, self-healing). */
export async function ensureFingerprintTable(): Promise<void> {
  if (tableReady) return;
  await getPool()
    .query(
      `CREATE TABLE IF NOT EXISTS supplier_fingerprints (
         id INT AUTO_INCREMENT PRIMARY KEY,
         keyword VARCHAR(160) NOT NULL,
         supplier_name VARCHAR(255) NOT NULL,
         account_number VARCHAR(20) NULL,
         account_name VARCHAR(255) NULL,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    )
    .catch(() => {});
  tableReady = true;
}

export async function listSupplierFingerprints(): Promise<SupplierFingerprint[]> {
  await ensureFingerprintTable();
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT id, keyword, supplier_name, account_number, account_name FROM supplier_fingerprints ORDER BY CHAR_LENGTH(keyword) DESC, id ASC"
  );
  return rows.map((r) => ({
    id: r.id as number,
    keyword: r.keyword as string,
    supplierName: r.supplier_name as string,
    accountNumber: (r.account_number as string | null) ?? null,
    accountName: (r.account_name as string | null) ?? null,
  }));
}

export async function addSupplierFingerprint(input: {
  keyword: string;
  supplierName: string;
  accountNumber?: string | null;
  accountName?: string | null;
}): Promise<void> {
  await ensureFingerprintTable();
  const keyword = input.keyword.trim();
  const supplierName = input.supplierName.trim();
  if (!keyword || !supplierName) return;
  await getPool().query(
    "INSERT INTO supplier_fingerprints (keyword, supplier_name, account_number, account_name) VALUES (?, ?, ?, ?)",
    [keyword, supplierName, input.accountNumber?.trim() || null, input.accountName?.trim() || null]
  );
}

export async function deleteSupplierFingerprint(id: number): Promise<void> {
  await ensureFingerprintTable();
  await getPool().query("DELETE FROM supplier_fingerprints WHERE id = ?", [id]);
}

/**
 * Sucht den ersten passenden Fingerabdruck im Text (längster Merkmal-Treffer zuerst).
 * `text` sollte OCR-Volltext + erkannten Lieferant/Beschreibung enthalten.
 */
export async function matchSupplierFingerprint(text: string): Promise<SupplierFingerprint | null> {
  const hay = (text ?? "").toLowerCase();
  if (!hay) return null;
  const list = await listSupplierFingerprints().catch(() => []);
  for (const fp of list) {
    if (fp.keyword && hay.includes(fp.keyword.toLowerCase())) return fp;
  }
  return null;
}

/**
 * Wendet – falls ein Fingerabdruck passt – den kanonischen Lieferanten (und optional
 * das Konto) auf ein Extraktionsergebnis an. Gibt die (ggf. korrigierten) Werte zurück.
 */
export async function applySupplierFingerprint(input: {
  fullText?: string | null;
  supplier: string | null;
  description?: string | null;
  accountNumber: string | null;
  accountName: string | null;
}): Promise<{ supplier: string | null; accountNumber: string | null; accountName: string | null; matched: boolean }> {
  const text = `${input.fullText ?? ""} ${input.supplier ?? ""} ${input.description ?? ""}`;
  const fp = await matchSupplierFingerprint(text);
  if (!fp) {
    return { supplier: input.supplier, accountNumber: input.accountNumber, accountName: input.accountName, matched: false };
  }
  return {
    supplier: fp.supplierName, // kanonischer Lieferant erzwingen
    // Konto nur ergänzen, wenn hinterlegt UND noch keins erkannt wurde.
    accountNumber: input.accountNumber ?? fp.accountNumber,
    accountName: input.accountNumber ? input.accountName : input.accountName ?? fp.accountName,
    matched: true,
  };
}
