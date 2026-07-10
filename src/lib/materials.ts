import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";
import type { Material, StockMovement } from "./material-types";

export type { Material, StockMovement };

interface MaterialRow extends RowDataPacket {
  id: number;
  name: string;
  sku: string | null;
  unit: string;
  quantity: string | number;
  min_stock: string | number | null;
}

interface MovementRow extends RowDataPacket {
  id: number;
  material_id: number;
  material_name: string;
  delta: string | number;
  comment: string | null;
  by_name: string | null;
  project_name: string | null;
  project_relative_id: number | null;
  employee_name: string | null;
  created_at: string | null;
}

const num = (v: string | number | null): number => (v == null ? 0 : Number(v));

interface QtyRow extends RowDataPacket {
  hero_article_id: number;
  quantity: string | number;
}

/**
 * Imports the HERO article master (incl. EK price) into the local materials
 * table without touching quantities. EK is stored for later use, not displayed.
 */
export async function syncArticleMaster(
  articles: {
    id: number;
    name: string;
    itemNumber: string;
    unit: string;
    purchasePrice: number | null;
  }[]
): Promise<void> {
  if (articles.length === 0) return;
  const values = articles.map((a) => [a.id, a.name, a.itemNumber || null, a.unit, 0, a.purchasePrice]);
  await getPool().query(
    `INSERT INTO materials (hero_article_id, name, sku, unit, quantity, ek_price) VALUES ?
     ON DUPLICATE KEY UPDATE name = VALUES(name), sku = VALUES(sku), unit = VALUES(unit),
       -- Manuell hinterlegten EK nicht durch einen leeren HERO-Preis überschreiben.
       ek_price = IF(VALUES(ek_price) > 0, VALUES(ek_price), ek_price)`,
    [values]
  );
}

/** Local EK prices per HERO article id. */
export async function getLocalEkPrices(): Promise<Map<number, number>> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT hero_article_id, ek_price FROM materials WHERE hero_article_id IS NOT NULL"
  );
  const map = new Map<number, number>();
  for (const r of rows) map.set(r.hero_article_id as number, num(r.ek_price as number));
  return map;
}

/**
 * Sets the EK price for an article (manual, persists across HERO syncs) and
 * backfills it onto past bookings that had NO price yet. Bookings that already
 * carry an EK snapshot keep their original value (price changes only apply to
 * new bookings).
 */
export async function setMaterialEkByArticle(heroArticleId: number, price: number): Promise<void> {
  const pool = getPool();
  await pool.query("UPDATE materials SET ek_price = ? WHERE hero_article_id = ?", [
    price,
    heroArticleId,
  ]);
  if (price > 0) {
    await pool.query(
      `UPDATE stock_movements mv
         JOIN materials m ON m.id = mv.material_id
          SET mv.ek_price = ?
        WHERE m.hero_article_id = ? AND (mv.ek_price IS NULL OR mv.ek_price = 0)`,
      [price, heroArticleId]
    );
  }
}

/** Of the given article ids, those without an EK price (0 or null). */
export async function listArticlesWithoutEk(
  heroArticleIds: number[]
): Promise<{ heroArticleId: number; name: string }[]> {
  if (heroArticleIds.length === 0) return [];
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT hero_article_id, name FROM materials
      WHERE hero_article_id IN (?) AND (ek_price IS NULL OR ek_price = 0)`,
    [heroArticleIds]
  );
  return rows.map((r) => ({ heroArticleId: r.hero_article_id as number, name: r.name as string }));
}

/** Lager-Minimum/-Maximum je HERO-Artikel-ID (lokal gepflegt). */
export async function getLocalMinMax(): Promise<Map<number, { min: number | null; max: number | null }>> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT hero_article_id, min_stock, max_stock FROM materials WHERE hero_article_id IS NOT NULL"
  );
  const map = new Map<number, { min: number | null; max: number | null }>();
  for (const r of rows as { hero_article_id: number; min_stock: string | number | null; max_stock: string | number | null }[]) {
    map.set(r.hero_article_id, {
      min: r.min_stock == null ? null : num(r.min_stock),
      max: r.max_stock == null ? null : num(r.max_stock),
    });
  }
  return map;
}

/** Setzt Lager-Minimum/-Maximum eines Artikels (upsert – Stammdaten aus HERO). */
export async function setMaterialMinMaxByArticle(
  article: { heroArticleId: number; name: string; unit: string },
  min: number | null,
  max: number | null
): Promise<void> {
  await getPool().query(
    `INSERT INTO materials (hero_article_id, name, sku, unit, quantity, min_stock, max_stock)
     VALUES (?, ?, NULL, ?, 0, ?, ?)
     ON DUPLICATE KEY UPDATE min_stock = VALUES(min_stock), max_stock = VALUES(max_stock)`,
    [article.heroArticleId, article.name.slice(0, 255), article.unit || "Stk", min, max]
  );
}

/** Local stock quantity per HERO article id (item master comes from HERO). */
export async function getLocalQuantities(): Promise<Map<number, number>> {
  const [rows] = await getPool().query<QtyRow[]>(
    "SELECT hero_article_id, quantity FROM materials WHERE hero_article_id IS NOT NULL"
  );
  const map = new Map<number, number>();
  for (const r of rows) map.set(r.hero_article_id, num(r.quantity));
  return map;
}

/**
 * Books a local stock change for a HERO article (delta > 0 = Einbuchen,
 * < 0 = Abbuchen). Creates the local stock row on first use from the HERO
 * article master data, then updates the quantity and logs the movement.
 */
export interface BookingContext {
  comment: string | null;
  userId: number | null;
  projectRelativeId?: number | null;
  projectName?: string | null;
  employeeName?: string | null;
  direction?: "in" | "out" | null;
}

export async function bookStockByArticle(
  article: { heroArticleId: number; name: string; sku: string | null; unit: string },
  delta: number,
  ctx: BookingContext
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO materials (hero_article_id, name, sku, unit, quantity) VALUES (?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE name = VALUES(name), sku = VALUES(sku), unit = VALUES(unit)`,
    [article.heroArticleId, article.name, article.sku, article.unit]
  );
  const [rows] = await pool.query<MaterialRow[]>(
    "SELECT id, ek_price FROM materials WHERE hero_article_id = ? LIMIT 1",
    [article.heroArticleId]
  );
  const materialId = rows[0]?.id;
  if (!materialId) return;
  // EK zum Buchungszeitpunkt einfrieren (spätere Preisänderungen ändern alte
  // Buchungen nicht). 0/leer = noch kein Preis → wird später nachgetragen.
  const ekSnapshot = num((rows[0] as { ek_price?: string | number | null }).ek_price ?? 0);
  await pool.query("UPDATE materials SET quantity = quantity + ? WHERE id = ?", [delta, materialId]);
  await pool.query(
    `INSERT INTO stock_movements
       (material_id, delta, comment, user_id, project_relative_id, project_name, employee_name, direction, ek_price)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      materialId,
      delta,
      ctx.comment,
      ctx.userId,
      ctx.projectRelativeId ?? null,
      ctx.projectName ?? null,
      ctx.employeeName ?? null,
      ctx.direction ?? null,
      ekSnapshot,
    ]
  );
}

export interface StockOutItem {
  date: string | null;
  materialName: string;
  projectName: string | null;
  projectRelativeId: number | null;
  quantity: number;
  unit: string;
  /** EK value = quantity × ek_price. */
  value: number;
  /** Employee who took the material (mv.employee_name). */
  employeeName: string | null;
  /** User who booked the movement. */
  byName: string | null;
  isDay: boolean;
  isWeek: boolean;
  isMonth: boolean;
}

export interface PeriodTotal {
  label: string;
  value: number;
}

export interface StockOutReport {
  totals: { daily: number; weekly: number; monthly: number };
  items: StockOutItem[];
  weekly: PeriodTotal[];
  monthly: PeriodTotal[];
}

interface OutItemRow extends RowDataPacket {
  created_at: string | null;
  material_name: string;
  unit: string;
  project_name: string | null;
  project_relative_id: number | null;
  qty: string | number;
  ek_price: string | number | null;
  employee_name: string | null;
  by_name: string | null;
}

const MONTH_SHORT = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

/** ISO week (Mon-based) and its ISO year for a date. */
function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; // Mon=1..Sun=7
  t.setUTCDate(t.getUTCDate() + 4 - day); // shift to Thursday of this week
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: t.getUTCFullYear(), week };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Outbound stock (Abbuchungen) valued at EK: per-item detail for the current
 * day/week/month plus weekly (last 8) and monthly (last 12) comparison totals.
 */
export async function getStockOutboundReport(): Promise<StockOutReport> {
  const [rows] = await getPool().query<OutItemRow[]>(
    `SELECT mv.created_at, m.name AS material_name, m.unit,
            mv.project_name, mv.project_relative_id,
            -mv.delta AS qty, mv.ek_price, mv.employee_name,
            COALESCE(NULLIF(u.display_name, ''), u.username) AS by_name
       FROM stock_movements mv
       JOIN materials m ON m.id = mv.material_id
       LEFT JOIN users u ON u.id = mv.user_id
      WHERE mv.delta < 0 AND mv.created_at >= (CURDATE() - INTERVAL 370 DAY)
      ORDER BY mv.created_at DESC, mv.id DESC`
  );

  const now = new Date();
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const curWeek = isoWeek(now);
  const curMonth = { y: now.getFullYear(), m: now.getMonth() };

  // Vergleichs-Buckets vorbereiten (chronologisch).
  const weekKeys: string[] = [];
  const weekLabels = new Map<string, string>();
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const w = isoWeek(d);
    const key = `${w.year}-W${w.week}`;
    if (!weekLabels.has(key)) {
      weekKeys.push(key);
      weekLabels.set(key, `KW ${w.week}`);
    }
  }
  const monthKeys: string[] = [];
  const monthLabels = new Map<string, string>();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    monthKeys.push(key);
    monthLabels.set(key, `${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`);
  }
  const weekSum = new Map<string, number>(weekKeys.map((k) => [k, 0]));
  const monthSum = new Map<string, number>(monthKeys.map((k) => [k, 0]));

  const items: StockOutItem[] = [];
  for (const r of rows) {
    if (!r.created_at) continue;
    const dt = new Date(r.created_at);
    const qty = num(r.qty);
    const value = round2(qty * num(r.ek_price ?? 0));
    const w = isoWeek(dt);
    const dayKey = `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
    const isDay = dayKey === todayKey;
    const isWeek = w.year === curWeek.year && w.week === curWeek.week;
    const isMonth = dt.getFullYear() === curMonth.y && dt.getMonth() === curMonth.m;

    if (isMonth || isWeek) {
      items.push({
        date: r.created_at,
        materialName: r.material_name,
        projectName: r.project_name,
        projectRelativeId: r.project_relative_id,
        quantity: qty,
        unit: r.unit,
        value,
        employeeName: r.employee_name,
        byName: r.by_name,
        isDay,
        isWeek,
        isMonth,
      });
    }

    const wk = `${w.year}-W${w.week}`;
    if (weekSum.has(wk)) weekSum.set(wk, weekSum.get(wk)! + value);
    const mk = `${dt.getFullYear()}-${dt.getMonth()}`;
    if (monthSum.has(mk)) monthSum.set(mk, monthSum.get(mk)! + value);
  }

  const totals = {
    daily: round2(items.filter((i) => i.isDay).reduce((s, i) => s + i.value, 0)),
    weekly: round2(items.filter((i) => i.isWeek).reduce((s, i) => s + i.value, 0)),
    monthly: round2(items.filter((i) => i.isMonth).reduce((s, i) => s + i.value, 0)),
  };

  return {
    totals,
    items,
    weekly: weekKeys.map((k) => ({ label: weekLabels.get(k)!, value: round2(weekSum.get(k) ?? 0) })),
    monthly: monthKeys.map((k) => ({ label: monthLabels.get(k)!, value: round2(monthSum.get(k) ?? 0) })),
  };
}

export interface ProjectBookedMaterialItem {
  materialName: string;
  unit: string;
  /** Netto auf das Projekt gebuchte Menge (Abbuchungen − Rückbuchungen). */
  quantity: number;
  /** EK-Wert = Menge × EK-Preis (zum Buchungszeitpunkt eingefroren). */
  value: number;
}

export interface ProjectBookedMaterials {
  items: ProjectBookedMaterialItem[];
  total: number;
}

/**
 * Tatsächlich auf ein Projekt gebuchte Ware (Lagerbewegungen), je Artikel
 * zusammengefasst und mit EK bewertet. Projekt über relative_id (wie gebucht).
 */
export async function getProjectBookedMaterials(
  projectRelativeId: number
): Promise<ProjectBookedMaterials> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT m.name AS material_name, m.unit, -mv.delta AS qty, mv.ek_price
       FROM stock_movements mv
       JOIN materials m ON m.id = mv.material_id
      WHERE mv.project_relative_id = ?`,
    [projectRelativeId]
  );

  const map = new Map<string, ProjectBookedMaterialItem>();
  for (const r of rows as { material_name: string; unit: string; qty: string | number; ek_price: string | number | null }[]) {
    const qty = num(r.qty);
    const value = qty * num(r.ek_price ?? 0);
    const key = `${r.material_name}|${r.unit ?? ""}`;
    const cur = map.get(key) ?? { materialName: r.material_name, unit: r.unit ?? "", quantity: 0, value: 0 };
    cur.quantity += qty;
    cur.value += value;
    map.set(key, cur);
  }

  const items = [...map.values()]
    .map((i) => ({ ...i, quantity: round2(i.quantity), value: round2(i.value) }))
    .filter((i) => Math.abs(i.quantity) > 0.0001 || Math.abs(i.value) > 0.0001)
    .sort((a, b) => b.value - a.value);
  const total = round2(items.reduce((s, i) => s + i.value, 0));
  return { items, total };
}

/**
 * EK-Wert der auf JEDES Projekt gebuchten Lagerware (Netto: Abbuchungen − Rückbuchungen),
 * keyed nach project_relative_id. Für die Projektliste-Spalte „Ist Lagerware".
 */
export async function getBookedStockTotalsByProject(): Promise<Map<number, number>> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT mv.project_relative_id AS pid, SUM(-mv.delta * mv.ek_price) AS val
       FROM stock_movements mv
      WHERE mv.project_relative_id IS NOT NULL
      GROUP BY mv.project_relative_id`
  );
  const map = new Map<number, number>();
  for (const r of rows as { pid: number | null; val: string | number | null }[]) {
    if (r.pid == null) continue;
    map.set(Number(r.pid), round2(num(r.val)));
  }
  return map;
}

/** Recent stock movements (newest first). */
export async function listRecentMovements(limit = 50): Promise<StockMovement[]> {
  const [rows] = await getPool().query<MovementRow[]>(
    `SELECT mv.id, mv.material_id, mv.delta, mv.comment, mv.created_at,
            mv.project_name, mv.project_relative_id, mv.employee_name,
            m.name AS material_name,
            COALESCE(NULLIF(u.display_name, ''), u.username) AS by_name
     FROM stock_movements mv
     JOIN materials m ON m.id = mv.material_id
     LEFT JOIN users u ON u.id = mv.user_id
     ORDER BY mv.created_at DESC, mv.id DESC
     LIMIT ?`,
    [limit]
  );
  return rows.map((r) => ({
    id: r.id,
    materialId: r.material_id,
    materialName: r.material_name,
    delta: num(r.delta),
    comment: r.comment,
    byName: r.by_name,
    projectName: r.project_name,
    projectRelativeId: r.project_relative_id,
    employeeName: r.employee_name,
    at: r.created_at ? String(r.created_at) : null,
  }));
}

