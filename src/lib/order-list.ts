import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

export interface OrderItem {
  id: number;
  articleKey: string;
  articleLabel: string;
  supplier: string | null;
  unitPrice: number | null;
  unit: string | null;
  quantity: number | null;
  note: string | null;
  link: string | null;
  done: boolean;
  addedByName: string | null;
  addedAt: string | null;
}

interface OrderRow extends RowDataPacket {
  id: number;
  article_key: string;
  article_label: string;
  supplier: string | null;
  unit_price: string | number | null;
  unit: string | null;
  quantity: string | number | null;
  note: string | null;
  link: string | null;
  done: number;
  added_by_name: string | null;
  added_at: string | null;
}

export async function listOrderList(): Promise<OrderItem[]> {
  const [rows] = await getPool().query<OrderRow[]>(
    `SELECT o.id, o.article_key, o.article_label, o.supplier, o.unit_price, o.unit, o.quantity, o.note, o.link, o.done, o.added_at,
            COALESCE(NULLIF(u.display_name, ''), u.username) AS added_by_name
       FROM order_list o
       LEFT JOIN users u ON u.id = o.added_by
      ORDER BY o.done ASC, o.supplier ASC, o.article_label ASC`
  );
  return rows.map((r) => ({
    id: r.id,
    articleKey: r.article_key,
    articleLabel: r.article_label,
    supplier: r.supplier,
    unitPrice: r.unit_price == null ? null : Number(r.unit_price),
    unit: r.unit,
    quantity: r.quantity == null ? null : Number(r.quantity),
    note: r.note,
    link: r.link,
    done: r.done === 1,
    addedByName: r.added_by_name,
    addedAt: r.added_at ? String(r.added_at) : null,
  }));
}

export interface OrderInput {
  articleKey: string;
  articleLabel: string;
  supplier: string | null;
  unitPrice: number | null;
  unit: string | null;
}

/** Fügt Artikel zur Bestellliste hinzu (je Artikel ein Eintrag; Lieferant/Preis werden aktualisiert). */
export async function addToOrderList(items: OrderInput[], userId: number | null): Promise<number> {
  const clean = items.filter((i) => i.articleKey && i.articleLabel);
  if (clean.length === 0) return 0;
  const [res] = await getPool().query(
    `INSERT INTO order_list (article_key, article_label, supplier, unit_price, unit, added_by) VALUES ?
     ON DUPLICATE KEY UPDATE article_label = VALUES(article_label), supplier = VALUES(supplier),
       unit_price = VALUES(unit_price), unit = VALUES(unit)`,
    [clean.map((i) => [i.articleKey.slice(0, 191), i.articleLabel.slice(0, 255), i.supplier, i.unitPrice, i.unit, userId])]
  );
  return (res as { affectedRows: number }).affectedRows;
}

/** Fügt einen manuell erfassten Artikel hinzu (freie Eingabe inkl. Internet-Link). */
export async function addManualOrderItem(
  input: {
    articleLabel: string;
    supplier: string | null;
    unitPrice: number | null;
    unit: string | null;
    quantity: number | null;
    link: string | null;
    note: string | null;
  },
  userId: number | null
): Promise<void> {
  const label = input.articleLabel.trim();
  if (!label) return;
  const key = `manual:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  await getPool().query(
    `INSERT INTO order_list (article_key, article_label, supplier, unit_price, unit, quantity, link, note, added_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [key, label.slice(0, 255), input.supplier, input.unitPrice, input.unit, input.quantity, input.link, input.note, userId]
  );
}

export async function updateOrderItem(
  id: number,
  patch: { quantity?: number | null; done?: boolean; note?: string | null; supplier?: string | null; link?: string | null }
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.quantity !== undefined) { sets.push("quantity = ?"); vals.push(patch.quantity); }
  if (patch.done !== undefined) { sets.push("done = ?"); vals.push(patch.done ? 1 : 0); }
  if (patch.note !== undefined) { sets.push("note = ?"); vals.push(patch.note); }
  if (patch.supplier !== undefined) { sets.push("supplier = ?"); vals.push(patch.supplier); }
  if (patch.link !== undefined) { sets.push("link = ?"); vals.push(patch.link); }
  if (sets.length === 0) return;
  vals.push(id);
  await getPool().query(`UPDATE order_list SET ${sets.join(", ")} WHERE id = ?`, vals);
}

export async function removeOrderItem(id: number): Promise<void> {
  await getPool().query("DELETE FROM order_list WHERE id = ?", [id]);
}

export async function clearDoneOrderItems(): Promise<void> {
  await getPool().query("DELETE FROM order_list WHERE done = 1");
}
