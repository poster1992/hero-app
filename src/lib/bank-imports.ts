import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

export interface StatementImport {
  fileHash: string;
  filename: string | null;
  statementNumber: string | null;
  txCount: number | null;
  total: number | null;
  importedByName: string | null;
  importedAt: string | null;
  /** Noch offene (nicht zugeordnete) Buchungen aus diesem Auszug. */
  openCount: number;
  /** Geschätzte OCR-Kosten (€) für diesen Import. */
  costEur: number | null;
}

interface Row extends RowDataPacket {
  file_hash: string;
  filename: string | null;
  statement_number: string | null;
  tx_count: number | null;
  total: string | number | null;
  imported_at: string | null;
  imported_by_name: string | null;
  open_count: number;
  cost_eur: string | number | null;
}

/** Liefert einen früheren Import dieses Auszugs (per Datei-Hash) oder null. */
export async function findStatementImport(fileHash: string): Promise<StatementImport | null> {
  const [rows] = await getPool().query<Row[]>(
    `SELECT si.file_hash, si.filename, si.statement_number, si.tx_count, si.total, si.imported_at, si.cost_eur,
            COALESCE(NULLIF(u.display_name, ''), u.username) AS imported_by_name,
            0 AS open_count
     FROM bank_statement_imports si
     LEFT JOIN users u ON u.id = si.imported_by
     WHERE si.file_hash = ? LIMIT 1`,
    [fileHash]
  );
  const r = rows[0];
  if (!r) return null;
  return mapRow(r);
}

function mapRow(r: Row): StatementImport {
  return {
    fileHash: r.file_hash,
    filename: r.filename,
    statementNumber: r.statement_number,
    txCount: r.tx_count,
    total: r.total == null ? null : Number(r.total),
    importedByName: r.imported_by_name,
    importedAt: r.imported_at ? String(r.imported_at) : null,
    openCount: Number(r.open_count ?? 0),
    costEur: r.cost_eur == null ? null : Number(r.cost_eur),
  };
}

/** Historie aller eingelesenen Auszüge (neueste zuerst), inkl. Anzahl noch offener Buchungen. */
export async function listStatementImports(): Promise<StatementImport[]> {
  const [rows] = await getPool().query<Row[]>(
    `SELECT si.file_hash, si.filename, si.statement_number, si.tx_count, si.total, si.imported_at, si.cost_eur,
            COALESCE(NULLIF(u.display_name, ''), u.username) AS imported_by_name,
            (SELECT COUNT(*) FROM bank_transactions bt
               WHERE bt.statement_hash = si.file_hash AND bt.status = 'offen') AS open_count
     FROM bank_statement_imports si
     LEFT JOIN users u ON u.id = si.imported_by
     ORDER BY si.imported_at DESC`
  );
  return rows.map(mapRow);
}

/** Vermerkt einen eingelesenen Auszug (für Doppel-Erkennung und Historie). */
export async function recordStatementImport(input: {
  fileHash: string;
  filename: string | null;
  statementNumber: string | null;
  txCount: number | null;
  total: number | null;
  userId: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costEur?: number | null;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO bank_statement_imports
       (file_hash, filename, statement_number, tx_count, total, imported_by, input_tokens, output_tokens, cost_eur)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE filename = VALUES(filename), statement_number = VALUES(statement_number),
       tx_count = VALUES(tx_count), total = VALUES(total), imported_by = VALUES(imported_by),
       input_tokens = VALUES(input_tokens), output_tokens = VALUES(output_tokens), cost_eur = VALUES(cost_eur),
       imported_at = NOW()`,
    [
      input.fileHash,
      input.filename,
      input.statementNumber,
      input.txCount,
      input.total,
      input.userId,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.costEur ?? null,
    ]
  );
}

/**
 * Löscht einen Auszug aus der Historie und entfernt seine noch OFFENEN Buchungen
 * aus der Arbeitsliste. Bereits zugeordnete (erledigte) Buchungen und die als
 * bezahlt markierten Belege bleiben unberührt.
 */
export async function deleteStatementImport(fileHash: string): Promise<number> {
  const pool = getPool();
  const [del] = await pool.query(
    "DELETE FROM bank_transactions WHERE statement_hash = ? AND status = 'offen'",
    [fileHash]
  );
  await pool.query("DELETE FROM bank_statement_imports WHERE file_hash = ?", [fileHash]);
  return (del as { affectedRows?: number }).affectedRows ?? 0;
}
