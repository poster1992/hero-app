import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { getPool } from "./db";

/** Eine Position eines Lohnlaufs (Empfänger + Betrag). */
export interface LohnRunPosition {
  name: string;
  iban: string;
  amount: number;
}

/** Ein gespeicherter Lohnlauf (Historie eines SEPA-Exports). */
export interface LohnRun {
  id: number;
  reference: string;
  executionDate: string | null;
  count: number;
  total: number;
  debtorName: string | null;
  positions: LohnRunPosition[];
  createdByName: string | null;
  createdAt: string | null;
}

interface RunRow extends RowDataPacket {
  id: number;
  reference: string;
  execution_date: string | null;
  tx_count: number;
  total: string | number;
  debtor_name: string | null;
  positions: unknown;
  created_at: string | null;
  created_by_name: string | null;
}

function parsePositions(value: unknown): LohnRunPosition[] {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => ({
      name: String((p as LohnRunPosition)?.name ?? ""),
      iban: String((p as LohnRunPosition)?.iban ?? ""),
      amount: Number((p as LohnRunPosition)?.amount ?? 0),
    }))
    .filter((p) => p.name || p.amount);
}

/** Speichert einen Lohnlauf in der Historie. Gibt die id zurück. */
export async function recordLohnRun(input: {
  reference: string;
  executionDate: string | null;
  count: number;
  total: number;
  debtorName: string | null;
  positions: LohnRunPosition[];
  createdBy: number | null;
}): Promise<number> {
  const [res] = await getPool().query<ResultSetHeader>(
    `INSERT INTO lohn_runs (reference, execution_date, tx_count, total, debtor_name, positions, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.reference.slice(0, 200),
      input.executionDate,
      input.count,
      input.total,
      input.debtorName?.slice(0, 200) ?? null,
      JSON.stringify(input.positions),
      input.createdBy,
    ]
  );
  return res.insertId;
}

/** Alle Lohnläufe, neueste zuerst. */
export async function listLohnRuns(): Promise<LohnRun[]> {
  const [rows] = await getPool().query<RunRow[]>(
    `SELECT r.id, r.reference, r.execution_date, r.tx_count, r.total, r.debtor_name,
            r.positions, r.created_at,
            COALESCE(NULLIF(u.display_name, ''), u.username) AS created_by_name
     FROM lohn_runs r
     LEFT JOIN users u ON u.id = r.created_by
     ORDER BY r.created_at DESC, r.id DESC`
  );
  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    executionDate: r.execution_date ? String(r.execution_date).slice(0, 10) : null,
    count: r.tx_count,
    total: Number(r.total),
    debtorName: r.debtor_name,
    positions: parsePositions(r.positions),
    createdByName: r.created_by_name,
    createdAt: r.created_at ? String(r.created_at) : null,
  }));
}

/** Entfernt einen Lohnlauf aus der Historie. */
export async function deleteLohnRun(id: number): Promise<void> {
  await getPool().query("DELETE FROM lohn_runs WHERE id = ?", [id]);
}
