import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

export interface MergeInfo {
  targetKey: string;
  targetLabel: string;
}

/** Normalisierter Artikelschlüssel (identisch zur Gruppierung in der Auswertung). */
export function articleKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 191);
}

/** source_key → { targetKey, targetLabel } für alle Zusammenführungen. */
export async function getMergeMap(): Promise<Record<string, MergeInfo>> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT source_key, target_key, target_label FROM article_merges"
  );
  const map: Record<string, MergeInfo> = {};
  for (const r of rows as { source_key: string; target_key: string; target_label: string }[]) {
    map[r.source_key] = { targetKey: r.target_key, targetLabel: r.target_label };
  }
  return map;
}

/**
 * Führt die Quell-Artikel (Schlüssel) unter dem Ziel-Artikel zusammen.
 * Bestehende Ketten (die auf eine Quelle zeigten) werden auf das Ziel umgehängt.
 */
export async function applyMerge(
  sources: string[],
  targetKey: string,
  targetLabel: string,
  createdBy: number | null
): Promise<void> {
  const pool = getPool();
  const srcs = sources.map((s) => s.slice(0, 191)).filter((s) => s && s !== targetKey);
  if (srcs.length === 0) return;

  // Bestehende Zuordnungen, die auf eine der Quellen zeigten, aufs Ziel umhängen.
  await pool.query("UPDATE article_merges SET target_key = ?, target_label = ? WHERE target_key IN (?)", [
    targetKey,
    targetLabel,
    srcs,
  ]);
  // Quellen aufs Ziel mappen.
  await pool.query(
    `INSERT INTO article_merges (source_key, target_key, target_label, created_by) VALUES ?
     ON DUPLICATE KEY UPDATE target_key = VALUES(target_key), target_label = VALUES(target_label)`,
    [srcs.map((s) => [s, targetKey, targetLabel, createdBy])]
  );
  // Label aller bestehenden Ziel-Zuordnungen aktualisieren (einheitlich).
  await pool.query("UPDATE article_merges SET target_label = ? WHERE target_key = ?", [targetLabel, targetKey]);
}

/** Löst eine Zusammenführung wieder auf (alle Quellen dieses Ziels entfernen). */
export async function removeMerge(targetKey: string): Promise<void> {
  await getPool().query("DELETE FROM article_merges WHERE target_key = ?", [targetKey]);
}
