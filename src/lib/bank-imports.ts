import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

export interface StatementImport {
  fileHash: string;
  filename: string | null;
  txCount: number | null;
  total: number | null;
  importedByName: string | null;
  importedAt: string | null;
}

interface Row extends RowDataPacket {
  file_hash: string;
  filename: string | null;
  tx_count: number | null;
  total: string | number | null;
  imported_at: string | null;
  imported_by_name: string | null;
}

/** Liefert einen früheren Import dieses Auszugs (per Datei-Hash) oder null. */
export async function findStatementImport(fileHash: string): Promise<StatementImport | null> {
  const [rows] = await getPool().query<Row[]>(
    `SELECT si.file_hash, si.filename, si.tx_count, si.total, si.imported_at,
            COALESCE(NULLIF(u.display_name, ''), u.username) AS imported_by_name
     FROM bank_statement_imports si
     LEFT JOIN users u ON u.id = si.imported_by
     WHERE si.file_hash = ? LIMIT 1`,
    [fileHash]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    fileHash: r.file_hash,
    filename: r.filename,
    txCount: r.tx_count,
    total: r.total == null ? null : Number(r.total),
    importedByName: r.imported_by_name,
    importedAt: r.imported_at ? String(r.imported_at) : null,
  };
}

/** Vermerkt einen eingelesenen Auszug (für die Doppel-Erkennung). */
export async function recordStatementImport(input: {
  fileHash: string;
  filename: string | null;
  txCount: number | null;
  total: number | null;
  userId: number | null;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO bank_statement_imports (file_hash, filename, tx_count, total, imported_by)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE filename = VALUES(filename), tx_count = VALUES(tx_count),
       total = VALUES(total), imported_by = VALUES(imported_by), imported_at = NOW()`,
    [input.fileHash, input.filename, input.txCount, input.total, input.userId]
  );
}
