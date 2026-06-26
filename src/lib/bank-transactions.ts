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

/** Stabiler Schlüssel je Buchung (Datum|Betrag|Name|Zweck) – verhindert exakten Doppel-Import. */
export function txnDedupKey(t: { date: string | null; amount: number; name: string; purpose: string }): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const base = `${t.date ?? ""}|${t.amount.toFixed(2)}|${norm(t.name)}|${norm(t.purpose)}`;
  return createHash("sha256").update(base).digest("hex");
}

/** Extrahiert die Zahlungsreferenz (REF/EREF) aus dem Verwendungszweck, z.B. „REF0007". */
function extractRef(purpose: string): string {
  const m = String(purpose || "").match(/REF0*\d+/i);
  return m ? m[0].toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
}

/**
 * Logischer Schlüssel je Buchung – robust gegen unterschiedliche Schreibweisen
 * desselben Verwendungszwecks (z.B. „REF0007 …" vs. „/EREF/REF0007/ …").
 * Mit Referenz: Betrag|REF (ohne Datum/Zweck-Text). Ohne Referenz: exakter Schlüssel.
 */
export function logicalTxnKey(t: { date: string | null; amount: number; name: string; purpose: string }): string {
  const ref = extractRef(t.purpose);
  if (ref) return createHash("sha256").update(`${t.amount.toFixed(2)}|${ref}`).digest("hex");
  return txnDedupKey(t);
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
    const lkey = logicalTxnKey(t);
    // Logisches Duplikat (auch bereits erledigte) überspringen – verhindert,
    // dass dieselbe Zahlung bei abweichendem Zweck-Text erneut auftaucht.
    const [dup] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM bank_transactions WHERE logical_key = ? LIMIT 1",
      [lkey]
    );
    if (dup.length > 0) continue;
    const [res] = await pool.query(
      `INSERT IGNORE INTO bank_transactions (dedup_key, logical_key, tx_date, amount, name, purpose, statement_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [key, lkey, t.date, t.amount, t.name.slice(0, 255), t.purpose.slice(0, 500), statementHash]
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
