import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";
import { getRunningLeasingMonthlySum } from "./vehicles";
import { getLatestLohnReceipt, listAllManualReceipts, searchManualOcrIds } from "./manual-receipts";
import { getReceiptsInRange } from "./hero-api";
import { getCustomerName } from "./invoices";
import { searchOcrHeroIds } from "./receipt-ocr";

const dateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
function fmtDate(iso: string | null): string {
  if (!iso) return "unbekanntes Datum";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "unbekanntes Datum" : dateFmt.format(d);
}
const round2 = (n: number) => Math.round(n * 100) / 100;

interface LinkResolveResult {
  amount: number;
  /** Zusatzinfo, welche konkrete Buchung/welcher Beleg hinter dem Betrag steckt. */
  detail: string | null;
}

/** "Modul"-Verknüpfungen: fester Betrag, global (nicht je Position) aus einem anderen Modul berechnet. */
type ModuleLinkSource = "fahrzeug_leasing" | "lohnkosten";
const MODULE_LINK_SOURCES: Record<ModuleLinkSource, { label: string; resolve: () => Promise<LinkResolveResult> }> = {
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

/** Alle Verknüpfungsarten: die beiden Modul-Verknüpfungen (global) + "belege" (je Position einzeln kuratiert). */
export type FixkostenLinkSource = ModuleLinkSource | "belege";

export function isFixkostenLinkSource(source: string): source is FixkostenLinkSource {
  return source === "belege" || source in MODULE_LINK_SOURCES;
}

export function isModuleLinkSource(source: FixkostenLinkSource): source is ModuleLinkSource {
  return source !== "belege";
}

export function getFixkostenLinkSourceLabel(source: ModuleLinkSource): string {
  return MODULE_LINK_SOURCES[source].label;
}

export interface FixkostenReceiptLink {
  id: number;
  kind: "manual" | "hero";
  ref: string;
  /** Netto-Betrag (ohne MwSt.), wie beim Verknüpfen übernommen. */
  amount: number;
  supplier: string | null;
  invoiceNumber: string | null;
}

export interface FixkostenItem {
  id: number;
  name: string;
  monthlyAmount: number;
  accountNumber: string | null;
  accountName: string | null;
  /** Gesetzt, wenn der Betrag live berechnet wird (nicht manuell editierbar). */
  linkedSource: FixkostenLinkSource | null;
  /** Bei verknüpften Positionen: zusätzlicher Hinweistext (z. B. welcher Beleg/wie viele Belege). */
  linkedDetail: string | null;
  /** Nur bei linkedSource === "belege": die einzeln verknüpften Belege. */
  receiptLinks: FixkostenReceiptLink[] | null;
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

let receiptsTableReady = false;
async function ensureReceiptsTable(): Promise<void> {
  if (receiptsTableReady) return;
  await getPool()
    .query(
      `CREATE TABLE IF NOT EXISTS fixkosten_receipts (
         id INT AUTO_INCREMENT PRIMARY KEY,
         fixkosten_id INT NOT NULL,
         receipt_kind VARCHAR(10) NOT NULL,
         receipt_ref VARCHAR(64) NOT NULL,
         amount DECIMAL(10,2) NOT NULL,
         supplier VARCHAR(191) NULL,
         invoice_number VARCHAR(191) NULL,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         INDEX idx_fixkosten_receipts_fixkosten (fixkosten_id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    )
    .catch(() => {});
  receiptsTableReady = true;
}

interface FixkostenReceiptRow extends RowDataPacket {
  id: number;
  fixkosten_id: number;
  receipt_kind: string;
  receipt_ref: string;
  amount: string | number;
  supplier: string | null;
  invoice_number: string | null;
}

async function listAllFixkostenReceipts(fixkostenIds: number[]): Promise<Map<number, FixkostenReceiptLink[]>> {
  await ensureReceiptsTable();
  const map = new Map<number, FixkostenReceiptLink[]>();
  if (fixkostenIds.length === 0) return map;
  const [rows] = await getPool().query<FixkostenReceiptRow[]>(
    `SELECT id, fixkosten_id, receipt_kind, receipt_ref, amount, supplier, invoice_number
       FROM fixkosten_receipts WHERE fixkosten_id IN (${fixkostenIds.map(() => "?").join(",")})
       ORDER BY id ASC`,
    fixkostenIds
  );
  for (const r of rows) {
    const arr = map.get(r.fixkosten_id) ?? [];
    arr.push({
      id: r.id,
      kind: r.receipt_kind === "hero" ? "hero" : "manual",
      ref: r.receipt_ref,
      amount: Number(r.amount),
      supplier: r.supplier,
      invoiceNumber: r.invoice_number,
    });
    map.set(r.fixkosten_id, arr);
  }
  return map;
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
    receiptLinks: null,
  }));

  const moduleSources = new Set(
    items
      .map((i) => i.linkedSource)
      .filter((s): s is ModuleLinkSource => s != null && isModuleLinkSource(s))
  );
  const resolved = new Map<ModuleLinkSource, LinkResolveResult>();
  for (const source of moduleSources) {
    resolved.set(source, await MODULE_LINK_SOURCES[source].resolve());
  }
  for (const item of items) {
    if (item.linkedSource && isModuleLinkSource(item.linkedSource)) {
      const r = resolved.get(item.linkedSource);
      item.monthlyAmount = r?.amount ?? 0;
      item.linkedDetail = r?.detail ?? null;
    }
  }

  const belegeItems = items.filter((i) => i.linkedSource === "belege");
  if (belegeItems.length > 0) {
    const receiptsByFixkosten = await listAllFixkostenReceipts(belegeItems.map((i) => i.id));
    for (const item of belegeItems) {
      const links = receiptsByFixkosten.get(item.id) ?? [];
      item.receiptLinks = links;
      item.monthlyAmount = round2(links.reduce((s, l) => s + l.amount, 0));
      item.linkedDetail =
        links.length === 0 ? "Noch keine Belege verknüpft" : `${links.length} Beleg${links.length === 1 ? "" : "e"} verknüpft`;
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
export async function createLinkedFixkosten(source: ModuleLinkSource): Promise<number | null> {
  await ensureTable();
  const { label } = MODULE_LINK_SOURCES[source];
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

export interface FixkostenReceiptOption {
  kind: "manual" | "hero";
  ref: string;
  /** Netto-Betrag (ohne MwSt.), nicht der Brutto-Rechnungsbetrag. */
  amount: number;
  supplier: string | null;
  invoiceNumber: string | null;
  date: string | null;
}

/**
 * Durchsucht Belege (manuell + HERO, letzte 3 Jahre) zum Verknüpfen mit einer
 * Fixkosten-Position. Anders als beim Kontoauszug-Abgleich zählen hier auch
 * bereits bezahlte Belege (die meisten verknüpften Rechnungen sind längst
 * bezahlt) und der Netto- statt des Brutto-/offenen Restbetrags (Fixkosten
 * sind Betriebsausgaben und werden wie in der GuV netto betrachtet).
 */
export async function searchReceiptsForFixkosten(
  query: string
): Promise<{ results: FixkostenReceiptOption[]; error?: string }> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return { results: [] };
  const results: FixkostenReceiptOption[] = [];
  let manualOk = false;
  let heroOk = false;
  let manualError: string | undefined;
  let heroError: string | undefined;

  try {
    const [manualReceipts, manualOcrIds] = await Promise.all([listAllManualReceipts(), searchManualOcrIds(q)]);
    for (const r of manualReceipts) {
      const hit =
        (r.supplier ?? "").toLowerCase().includes(q) ||
        (r.invoiceNumber ?? "").toLowerCase().includes(q) ||
        manualOcrIds.has(r.id);
      if (!hit) continue;
      results.push({
        kind: "manual",
        ref: String(r.id),
        // Netto, nicht Brutto (wie bei Betriebsausgaben in der GuV üblich).
        amount: r.net,
        supplier: r.supplier,
        invoiceNumber: r.invoiceNumber,
        date: r.date,
      });
      if (results.length >= 20) break;
    }
    manualOk = true;
  } catch (e) {
    manualError = e instanceof Error ? e.message : "Manuelle Beleg-Suche fehlgeschlagen.";
  }

  try {
    const to = new Date();
    const from = new Date();
    from.setFullYear(from.getFullYear() - 3);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const [heroReceipts, heroOcrIds] = await Promise.all([
      getReceiptsInRange(`${fmt(from)}T00:00:00Z`, `${fmt(to)}T23:59:59Z`),
      searchOcrHeroIds(q),
    ]);
    for (const r of heroReceipts) {
      const supplierName = getCustomerName(r);
      const hit =
        supplierName.toLowerCase().includes(q) || (r.number ?? "").toLowerCase().includes(q) || heroOcrIds.has(r.id);
      if (!hit) continue;
      results.push({
        kind: "hero",
        ref: r.id,
        // Netto (netValue), nicht Brutto (value) – wie bei Betriebsausgaben in der GuV üblich.
        amount: r.netValue,
        supplier: supplierName,
        invoiceNumber: r.number,
        date: r.receiptDate ? r.receiptDate.slice(0, 10) : null,
      });
      if (results.length >= 40) break;
    }
    heroOk = true;
  } catch (e) {
    heroError = e instanceof Error ? e.message : "HERO-Beleg-Suche fehlgeschlagen.";
  }

  const sorted = results.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 30);
  if (!manualOk && !heroOk) {
    return { results: sorted, error: manualError ?? heroError ?? "Suche fehlgeschlagen." };
  }
  return { results: sorted };
}

/** Hängt einen Beleg an eine Fixkosten-Position – setzt sie automatisch auf "belege"-verknüpft. */
export async function addReceiptToFixkosten(fixkostenId: number, option: FixkostenReceiptOption): Promise<void> {
  await ensureTable();
  await ensureReceiptsTable();
  await getPool().query(
    `INSERT INTO fixkosten_receipts (fixkosten_id, receipt_kind, receipt_ref, amount, supplier, invoice_number)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [fixkostenId, option.kind, option.ref, option.amount, option.supplier, option.invoiceNumber]
  );
  await getPool().query("UPDATE fixkosten SET linked_source = 'belege' WHERE id = ? AND linked_source IS NULL", [
    fixkostenId,
  ]);
}

/** Entfernt eine Beleg-Verknüpfung; fällt die Position dadurch auf 0 Belege zurück, wird sie wieder manuell editierbar. */
export async function removeFixkostenReceiptLink(linkId: number): Promise<void> {
  await ensureReceiptsTable();
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT fixkosten_id FROM fixkosten_receipts WHERE id = ? LIMIT 1",
    [linkId]
  );
  const fixkostenId = rows[0]?.fixkosten_id;
  await getPool().query("DELETE FROM fixkosten_receipts WHERE id = ?", [linkId]);
  if (fixkostenId != null) {
    const [remaining] = await getPool().query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM fixkosten_receipts WHERE fixkosten_id = ?",
      [fixkostenId]
    );
    if (Number(remaining[0]?.n ?? 0) === 0) {
      await getPool().query("UPDATE fixkosten SET linked_source = NULL WHERE id = ? AND linked_source = 'belege'", [
        fixkostenId,
      ]);
    }
  }
}

// ---------------------------------------------------------------------------
// Verlauf: monatliche "Stände" (Snapshots) der Fixkosten, GuV-artig darstellbar.
// ---------------------------------------------------------------------------

let snapshotTablesReady = false;
async function ensureSnapshotTables(): Promise<void> {
  if (snapshotTablesReady) return;
  const pool = getPool();
  await pool
    .query(
      `CREATE TABLE IF NOT EXISTS fixkosten_snapshots (
         id INT AUTO_INCREMENT PRIMARY KEY,
         year INT NOT NULL,
         month INT NOT NULL,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         created_by INT NULL,
         is_auto TINYINT NOT NULL DEFAULT 0,
         UNIQUE KEY uq_fixkosten_snapshot_period (year, month)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    )
    .catch(() => {});
  await pool
    .query(
      `CREATE TABLE IF NOT EXISTS fixkosten_snapshot_items (
         id INT AUTO_INCREMENT PRIMARY KEY,
         snapshot_id INT NOT NULL,
         name VARCHAR(191) NOT NULL,
         account_number VARCHAR(32) NULL,
         account_name VARCHAR(191) NULL,
         monthly_amount DECIMAL(10,2) NOT NULL,
         INDEX idx_fixkosten_snapshot_items_snapshot (snapshot_id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    )
    .catch(() => {});
  snapshotTablesReady = true;
}

/**
 * Speichert den aktuellen Stand aller Fixkosten-Positionen (inkl. live
 * berechneter Beträge bei Verknüpfungen) als "Stand" für einen Monat. Je
 * Monat gibt es höchstens einen Stand – ein erneutes Sichern im selben
 * Monat ersetzt den vorherigen (der zuletzt gesicherte Stand zählt, wie bei
 * der echten GuV-Monatsspalte).
 */
export async function saveFixkostenSnapshot(
  year: number,
  month: number,
  userId: number | null,
  isAuto: boolean
): Promise<void> {
  await ensureSnapshotTables();
  const items = await listFixkosten();
  const pool = getPool();

  const [existing] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM fixkosten_snapshots WHERE year = ? AND month = ? LIMIT 1",
    [year, month]
  );
  const existingId = existing[0]?.id as number | undefined;
  let snapshotId: number;
  if (existingId != null) {
    snapshotId = existingId;
    await pool.query("DELETE FROM fixkosten_snapshot_items WHERE snapshot_id = ?", [existingId]);
    await pool.query(
      "UPDATE fixkosten_snapshots SET created_at = CURRENT_TIMESTAMP, created_by = ?, is_auto = ? WHERE id = ?",
      [userId, isAuto ? 1 : 0, existingId]
    );
  } else {
    const [res] = await pool.query(
      "INSERT INTO fixkosten_snapshots (year, month, created_by, is_auto) VALUES (?, ?, ?, ?)",
      [year, month, userId, isAuto ? 1 : 0]
    );
    snapshotId = (res as { insertId: number }).insertId;
  }

  if (items.length > 0) {
    const values = items.map((i) => [snapshotId, i.name, i.accountNumber, i.accountName, i.monthlyAmount]);
    await pool.query(
      "INSERT INTO fixkosten_snapshot_items (snapshot_id, name, account_number, account_name, monthly_amount) VALUES ?",
      [values]
    );
  }
}

/** Legt automatisch (per Hintergrund-Timer) einen Stand für den aktuellen Monat an, falls noch keiner existiert. */
export async function maybeRunFixkostenSnapshot(): Promise<void> {
  await ensureSnapshotTables();
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT id FROM fixkosten_snapshots WHERE year = ? AND month = ? LIMIT 1",
    [year, month]
  );
  if (rows.length > 0) return;
  await saveFixkostenSnapshot(year, month, null, true);
}

export interface FixkostenHistoryRow {
  name: string;
  accountNumber: string | null;
  accountName: string | null;
  /** Index 0 = Januar … 11 = Dezember; null = in diesem Monat kein Stand bzw. Position nicht vorhanden. */
  monthly: (number | null)[];
}

export interface FixkostenHistoryMonth {
  hasSnapshot: boolean;
  isAuto: boolean;
  savedAt: string | null;
}

export interface FixkostenHistory {
  rows: FixkostenHistoryRow[];
  /** Summe aller Positionen je Monat (Gesamt-Fixkosten-Stand). */
  totalMonthly: number[];
  months: FixkostenHistoryMonth[];
}

interface SnapshotMetaRow extends RowDataPacket {
  id: number;
  month: number;
  created_at: string;
  is_auto: number;
}

interface SnapshotItemRow extends RowDataPacket {
  snapshot_id: number;
  name: string;
  account_number: string | null;
  account_name: string | null;
  monthly_amount: string | number;
}

/** Verlauf der Fixkosten für ein Jahr, GuV-artig (Positionen × Monate), aus den gesicherten Ständen. */
export async function getFixkostenHistory(year: number): Promise<FixkostenHistory> {
  await ensureSnapshotTables();
  const pool = getPool();

  const [snapshots] = await pool.query<SnapshotMetaRow[]>(
    "SELECT id, month, created_at, is_auto FROM fixkosten_snapshots WHERE year = ? ORDER BY month ASC",
    [year]
  );

  const months: FixkostenHistoryMonth[] = Array.from({ length: 12 }, () => ({
    hasSnapshot: false,
    isAuto: false,
    savedAt: null,
  }));
  const snapshotIdByMonth = new Map<number, number>();
  for (const s of snapshots) {
    const idx = s.month - 1;
    if (idx < 0 || idx > 11) continue;
    months[idx] = { hasSnapshot: true, isAuto: s.is_auto === 1, savedAt: String(s.created_at) };
    snapshotIdByMonth.set(s.id, idx);
  }

  const rowsByName = new Map<string, FixkostenHistoryRow>();
  const totalMonthly = new Array(12).fill(0);

  if (snapshots.length > 0) {
    const ids = snapshots.map((s) => s.id);
    const [items] = await pool.query<SnapshotItemRow[]>(
      `SELECT snapshot_id, name, account_number, account_name, monthly_amount
         FROM fixkosten_snapshot_items WHERE snapshot_id IN (${ids.map(() => "?").join(",")})`,
      ids
    );
    // Nach Monat sortieren, damit "neueste Konto-Zuordnung gewinnt" unten tatsächlich die
    // höchste Monatsnummer ist statt einer beliebigen SQL-Rückgabereihenfolge.
    const sortedItems = [...items].sort(
      (a, b) => (snapshotIdByMonth.get(a.snapshot_id) ?? -1) - (snapshotIdByMonth.get(b.snapshot_id) ?? -1)
    );
    for (const it of sortedItems) {
      const monthIdx = snapshotIdByMonth.get(it.snapshot_id);
      if (monthIdx == null) continue;
      const amount = Number(it.monthly_amount);
      const row =
        rowsByName.get(it.name) ??
        ({ name: it.name, accountNumber: it.account_number, accountName: it.account_name, monthly: new Array(12).fill(null) } as FixkostenHistoryRow);
      row.monthly[monthIdx] = amount;
      // Neueste bekannte Konto-Zuordnung gewinnt (falls sich das Konto über die Zeit geändert hat).
      row.accountNumber = it.account_number;
      row.accountName = it.account_name;
      rowsByName.set(it.name, row);
      totalMonthly[monthIdx] = round2(totalMonthly[monthIdx] + amount);
    }
  }

  const rows = [...rowsByName.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
  return { rows, totalMonthly, months };
}
