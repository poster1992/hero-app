import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";
import { getRunningLeasingMonthlySum } from "./vehicles";

/** Verknüpfungen: Positionen, deren Betrag live aus einem anderen Modul berechnet wird. */
export type FixkostenLinkSource = "fahrzeug_leasing";

const LINK_SOURCES: Record<FixkostenLinkSource, { label: string; resolve: () => Promise<number> }> = {
  fahrzeug_leasing: {
    label: "Fahrzeug Leasing (monatliche Rate, laufende Fahrzeuge)",
    resolve: getRunningLeasingMonthlySum,
  },
};

export function isFixkostenLinkSource(source: string): source is FixkostenLinkSource {
  return source in LINK_SOURCES;
}

export function getFixkostenLinkSourceLabel(source: FixkostenLinkSource): string {
  return LINK_SOURCES[source].label;
}

export interface FixkostenItem {
  id: number;
  name: string;
  monthlyAmount: number;
  /** Gesetzt, wenn der Betrag live aus einem anderen Modul berechnet wird (nicht manuell editierbar). */
  linkedSource: FixkostenLinkSource | null;
}

interface FixkostenRow extends RowDataPacket {
  id: number;
  name: string;
  monthly_amount: string | number;
  linked_source: string | null;
}

let tableReady = false;
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  const pool = getPool();
  await pool
    .query(
      `CREATE TABLE IF NOT EXISTS fixkosten (
         id INT AUTO_INCREMENT PRIMARY KEY,
         name VARCHAR(191) NOT NULL,
         monthly_amount DECIMAL(10,2) NOT NULL,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    )
    .catch(() => {});
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fixkosten' AND COLUMN_NAME = 'linked_source'`
  );
  if (rows.length === 0) {
    await pool.query("ALTER TABLE fixkosten ADD COLUMN linked_source VARCHAR(32) NULL").catch(() => {});
  }
  tableReady = true;
}

/** Alle Fixkosten-Positionen, alphabetisch sortiert. Verknüpfte Positionen bekommen ihren Betrag live berechnet. */
export async function listFixkosten(): Promise<FixkostenItem[]> {
  await ensureTable();
  const [rows] = await getPool().query<FixkostenRow[]>(
    "SELECT id, name, monthly_amount, linked_source FROM fixkosten ORDER BY name"
  );

  const items: FixkostenItem[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    monthlyAmount: Number(r.monthly_amount),
    linkedSource: r.linked_source && isFixkostenLinkSource(r.linked_source) ? r.linked_source : null,
  }));

  const neededSources = new Set(items.map((i) => i.linkedSource).filter((s): s is FixkostenLinkSource => s != null));
  const resolved = new Map<FixkostenLinkSource, number>();
  for (const source of neededSources) {
    resolved.set(source, await LINK_SOURCES[source].resolve());
  }
  for (const item of items) {
    if (item.linkedSource) item.monthlyAmount = resolved.get(item.linkedSource) ?? 0;
  }

  return items;
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

/** Legt eine verknüpfte Position an, deren Betrag live aus einem anderen Modul kommt. */
export async function createLinkedFixkosten(source: FixkostenLinkSource): Promise<number | null> {
  await ensureTable();
  const { label } = LINK_SOURCES[source];
  const [res] = await getPool().query("INSERT INTO fixkosten (name, monthly_amount, linked_source) VALUES (?, 0, ?)", [
    label,
    source,
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
