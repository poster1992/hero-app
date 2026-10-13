import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";
import { getRunningLeasingMonthlySum } from "./vehicles";
import { getLatestLohnReceipt } from "./manual-receipts";

const dateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
function fmtDate(iso: string | null): string {
  if (!iso) return "unbekanntes Datum";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "unbekanntes Datum" : dateFmt.format(d);
}

interface LinkResolveResult {
  amount: number;
  /** Zusatzinfo, welche konkrete Buchung/welcher Beleg hinter dem Betrag steckt. */
  detail: string | null;
}

/** Verknüpfungen: Positionen, deren Betrag live aus einem anderen Modul berechnet wird. */
export type FixkostenLinkSource = "fahrzeug_leasing" | "lohnkosten";

const LINK_SOURCES: Record<FixkostenLinkSource, { label: string; resolve: () => Promise<LinkResolveResult> }> = {
  fahrzeug_leasing: {
    label: "Fahrzeug Leasing (monatliche Rate, laufende Fahrzeuge)",
    resolve: async () => ({ amount: await getRunningLeasingMonthlySum(), detail: null }),
  },
  lohnkosten: {
    label: "Lohnkosten (letzte Lohnkostenabrechnung)",
    resolve: async () => {
      const latest = await getLatestLohnReceipt();
      if (!latest) return { amount: 0, detail: "Noch keine Lohnkostenabrechnung erfasst" };
      return { amount: latest.gross, detail: `Lohnkostenabrechnung vom ${fmtDate(latest.date)}` };
    },
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
  accountNumber: string | null;
  accountName: string | null;
  /** Gesetzt, wenn der Betrag live aus einem anderen Modul berechnet wird (nicht manuell editierbar). */
  linkedSource: FixkostenLinkSource | null;
  /** Bei verknüpften Positionen: welcher konkrete Beleg/Zeitraum hinter dem Betrag steckt. */
  linkedDetail: string | null;
}

interface FixkostenRow extends RowDataPacket {
  id: number;
  name: string;
  monthly_amount: string | number;
  account_number: string | null;
  account_name: string | null;
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
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fixkosten'
        AND COLUMN_NAME IN ('linked_source', 'account_number', 'account_name')`
  );
  const existing = new Set(rows.map((r) => String(r.COLUMN_NAME)));
  if (!existing.has("linked_source")) {
    await pool.query("ALTER TABLE fixkosten ADD COLUMN linked_source VARCHAR(32) NULL").catch(() => {});
  }
  if (!existing.has("account_number")) {
    await pool.query("ALTER TABLE fixkosten ADD COLUMN account_number VARCHAR(32) NULL").catch(() => {});
  }
  if (!existing.has("account_name")) {
    await pool.query("ALTER TABLE fixkosten ADD COLUMN account_name VARCHAR(191) NULL").catch(() => {});
  }
  tableReady = true;
}

/** Alle Fixkosten-Positionen, alphabetisch sortiert. Verknüpfte Positionen bekommen ihren Betrag live berechnet. */
export async function listFixkosten(): Promise<FixkostenItem[]> {
  await ensureTable();
  const [rows] = await getPool().query<FixkostenRow[]>(
    "SELECT id, name, monthly_amount, account_number, account_name, linked_source FROM fixkosten ORDER BY name"
  );

  const items: FixkostenItem[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    monthlyAmount: Number(r.monthly_amount),
    accountNumber: r.account_number,
    accountName: r.account_name,
    linkedSource: r.linked_source && isFixkostenLinkSource(r.linked_source) ? r.linked_source : null,
    linkedDetail: null,
  }));

  const neededSources = new Set(items.map((i) => i.linkedSource).filter((s): s is FixkostenLinkSource => s != null));
  const resolved = new Map<FixkostenLinkSource, LinkResolveResult>();
  for (const source of neededSources) {
    resolved.set(source, await LINK_SOURCES[source].resolve());
  }
  for (const item of items) {
    if (item.linkedSource) {
      const r = resolved.get(item.linkedSource);
      item.monthlyAmount = r?.amount ?? 0;
      item.linkedDetail = r?.detail ?? null;
    }
  }

  return items;
}

export async function createFixkosten(
  name: string,
  monthlyAmount: number,
  accountNumber: string | null,
  accountName: string | null
): Promise<number | null> {
  await ensureTable();
  const clean = name.trim();
  if (!clean) return null;
  const [res] = await getPool().query(
    "INSERT INTO fixkosten (name, monthly_amount, account_number, account_name) VALUES (?, ?, ?, ?)",
    [clean.slice(0, 191), monthlyAmount, accountNumber, accountName]
  );
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

/**
 * Speichert eine Position. Bei verknüpften Positionen (eigener Betrag kommt
 * immer live) bleibt `monthly_amount` unverändert, nur Bezeichnung + Konto
 * werden übernommen.
 */
export async function updateFixkosten(
  id: number,
  name: string,
  monthlyAmount: number,
  accountNumber: string | null,
  accountName: string | null
): Promise<void> {
  await ensureTable();
  const clean = name.trim();
  if (!clean) return;
  const [rows] = await getPool().query<RowDataPacket[]>("SELECT linked_source FROM fixkosten WHERE id = ? LIMIT 1", [
    id,
  ]);
  const isLinked = !!rows[0]?.linked_source;
  if (isLinked) {
    await getPool().query("UPDATE fixkosten SET name = ?, account_number = ?, account_name = ? WHERE id = ?", [
      clean.slice(0, 191),
      accountNumber,
      accountName,
      id,
    ]);
  } else {
    await getPool().query(
      "UPDATE fixkosten SET name = ?, monthly_amount = ?, account_number = ?, account_name = ? WHERE id = ?",
      [clean.slice(0, 191), monthlyAmount, accountNumber, accountName, id]
    );
  }
}

export async function deleteFixkosten(id: number): Promise<void> {
  await getPool().query("DELETE FROM fixkosten WHERE id = ?", [id]);
}
