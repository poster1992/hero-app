import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

/** Eine per OCR aus einem Beleg gelesene Artikelposition. */
export interface BelegArticle {
  name: string;
  quantity: number;
  unit: string | null;
  /** Einzelpreis netto (EK) je Einheit. */
  unitPrice: number;
  /** Positionssumme netto. */
  lineTotal: number;
}

export interface BelegArticleEntry {
  heroReceiptId: string;
  docHash: string | null;
  items: BelegArticle[];
  total: number;
}

interface ArticleRow extends RowDataPacket {
  hero_receipt_id: string;
  doc_hash: string | null;
  items: unknown;
  total: string | number;
}

function parseItems(value: unknown): BelegArticle[] {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => ({
    name: String((p as BelegArticle)?.name ?? ""),
    quantity: Number((p as BelegArticle)?.quantity ?? 0),
    unit: (p as BelegArticle)?.unit != null ? String((p as BelegArticle).unit) : null,
    unitPrice: Number((p as BelegArticle)?.unitPrice ?? 0),
    lineTotal: Number((p as BelegArticle)?.lineTotal ?? 0),
  }));
}

/** Gecachte OCR-Artikel für mehrere Belege (heroId → Eintrag). */
export async function getBelegArticlesMap(heroIds: string[]): Promise<Map<string, BelegArticleEntry>> {
  const map = new Map<string, BelegArticleEntry>();
  if (heroIds.length === 0) return map;
  const placeholders = heroIds.map(() => "?").join(",");
  const [rows] = await getPool().query<ArticleRow[]>(
    `SELECT hero_receipt_id, doc_hash, items, total FROM beleg_articles WHERE hero_receipt_id IN (${placeholders})`,
    heroIds
  );
  for (const r of rows) {
    map.set(r.hero_receipt_id, {
      heroReceiptId: r.hero_receipt_id,
      docHash: r.doc_hash,
      items: parseItems(r.items),
      total: Number(r.total),
    });
  }
  return map;
}

/** Löscht den OCR-Cache mehrerer Belege (erzwingt Neu-Auslesen). */
export async function deleteBelegArticles(heroIds: string[]): Promise<void> {
  if (heroIds.length === 0) return;
  const placeholders = heroIds.map(() => "?").join(",");
  await getPool().query(
    `DELETE FROM beleg_articles WHERE hero_receipt_id IN (${placeholders})`,
    heroIds
  );
}

/** Speichert/aktualisiert die OCR-Artikel eines Belegs. */
export async function upsertBelegArticles(input: {
  heroReceiptId: string;
  docHash: string | null;
  items: BelegArticle[];
  total: number;
  model: string | null;
  costEur: number;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO beleg_articles (hero_receipt_id, doc_hash, items, total, model, cost_eur)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE doc_hash = VALUES(doc_hash), items = VALUES(items),
       total = VALUES(total), model = VALUES(model), cost_eur = VALUES(cost_eur)`,
    [input.heroReceiptId, input.docHash, JSON.stringify(input.items), input.total, input.model, input.costEur]
  );
}
