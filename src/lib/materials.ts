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
     ON DUPLICATE KEY UPDATE name = VALUES(name), sku = VALUES(sku), unit = VALUES(unit), ek_price = VALUES(ek_price)`,
    [values]
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
    "SELECT id FROM materials WHERE hero_article_id = ? LIMIT 1",
    [article.heroArticleId]
  );
  const materialId = rows[0]?.id;
  if (!materialId) return;
  await pool.query("UPDATE materials SET quantity = quantity + ? WHERE id = ?", [delta, materialId]);
  await pool.query(
    `INSERT INTO stock_movements
       (material_id, delta, comment, user_id, project_relative_id, project_name, employee_name, direction)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      materialId,
      delta,
      ctx.comment,
      ctx.userId,
      ctx.projectRelativeId ?? null,
      ctx.projectName ?? null,
      ctx.employeeName ?? null,
      ctx.direction ?? null,
    ]
  );
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

