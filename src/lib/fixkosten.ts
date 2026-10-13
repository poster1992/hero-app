import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

export interface FixkostenItem {
  id: number;
  name: string;
  monthlyAmount: number;
}

interface FixkostenRow extends RowDataPacket {
  id: number;
  name: string;
  monthly_amount: string | number;
}

let tableReady = false;
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await getPool()
    .query(
      `CREATE TABLE IF NOT EXISTS fixkosten (
         id INT AUTO_INCREMENT PRIMARY KEY,
         name VARCHAR(191) NOT NULL,
         monthly_amount DECIMAL(10,2) NOT NULL,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    )
    .catch(() => {});
  tableReady = true;
}

/** Alle Fixkosten-Positionen, alphabetisch sortiert. */
export async function listFixkosten(): Promise<FixkostenItem[]> {
  await ensureTable();
  const [rows] = await getPool().query<FixkostenRow[]>(
    "SELECT id, name, monthly_amount FROM fixkosten ORDER BY name"
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    monthlyAmount: Number(r.monthly_amount),
  }));
}

export async function createFixkosten(name: string, monthlyAmount: number): Promise<number | null> {
  await ensureTable();
  const clean = name.trim();
  if (!clean) return null;
  const [res] = await getPool().query("INSERT INTO fixkosten (name, monthly_amount) VALUES (?, ?)", [
    clean.slice(0, 191),
    monthlyAmount,
  ]);
  return (res as { insertId: number }).insertId;
}

export async function updateFixkosten(id: number, name: string, monthlyAmount: number): Promise<void> {
  await ensureTable();
  const clean = name.trim();
  if (!clean) return;
  await getPool().query("UPDATE fixkosten SET name = ?, monthly_amount = ? WHERE id = ?", [
    clean.slice(0, 191),
    monthlyAmount,
    id,
  ]);
}

export async function deleteFixkosten(id: number): Promise<void> {
  await getPool().query("DELETE FROM fixkosten WHERE id = ?", [id]);
}
