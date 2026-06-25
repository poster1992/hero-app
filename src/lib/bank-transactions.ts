import { createHash } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

export interface PendingTxn {
  id: number;
  date: string | null;
  amount: number;
  name: string;
  purpose: string;
}

interface Row extends RowDataPacket {
  id: number;
  tx_date: string | null;
  amount: string | number;
  name: string | null;
  purpose: string | null;
}

/** Stabiler Schlüssel je Buchung (Datum|Betrag|Name|Zweck) – verhindert Doppel-Import. */
export function txnDedupKey(t: { date: string | null; amount: number; name: string; purpose: string }): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const base = `${t.date ?? ""}|${t.amount.toFixed(2)}|${norm(t.name)}|${norm(t.purpose)}`;
  return createHash("sha256").update(base).digest("hex");
}

/** Fügt neue offene Buchungen hinzu (überspringt bereits bekannte). Gibt die Anzahl neu hinzugefügter zurück. */
export async function addPendingTxns(
  txns: { date: string | null; amount: number; name: string; purpose: string }[],
  statementHash: string | null
): Promise<number> {
  if (txns.length === 0) return 0;
  const pool = getPool();
  let added = 0;
  for (const t of txns) {
    const key = txnDedupKey(t);
    const [res] = await pool.query(
      `INSERT IGNORE INTO bank_transactions (dedup_key, tx_date, amount, name, purpose, statement_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [key, t.date, t.amount, t.name.slice(0, 255), t.purpose.slice(0, 500), statementHash]
    );
    // mysql2 OkPacket: affectedRows = 1 bei Insert, 0 bei IGNORE (Duplikat)
    added += (res as { affectedRows?: number }).affectedRows ?? 0;
  }
  return added;
}

/** Alle offenen (noch nicht zugeordneten) Buchungen, neueste zuerst. */
export async function listPendingTxns(): Promise<PendingTxn[]> {
  const [rows] = await getPool().query<Row[]>(
    `SELECT id, tx_date, amount, name, purpose
     FROM bank_transactions WHERE status = 'offen'
     ORDER BY tx_date DESC, id DESC`
  );
  return rows.map((r) => ({
    id: r.id,
    date: r.tx_date ? String(r.tx_date).slice(0, 10) : null,
    amount: Number(r.amount),
    name: r.name ?? "",
    purpose: r.purpose ?? "",
  }));
}

/** Markiert Buchungen als erledigt (verschwinden aus der Liste). */
export async function markTxnsDone(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await getPool().query(
    `UPDATE bank_transactions SET status = 'erledigt' WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids
  );
}
