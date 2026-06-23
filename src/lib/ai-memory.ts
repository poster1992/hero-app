import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

export interface MemoryItem {
  id: number;
  content: string;
}

interface MemoryRow extends RowDataPacket {
  id: number;
  content: string;
}

/** All remembered notes (oldest first). */
export async function listMemories(): Promise<MemoryItem[]> {
  const [rows] = await getPool().query<MemoryRow[]>(
    "SELECT id, content FROM ai_memory ORDER BY id"
  );
  return rows.map((r) => ({ id: r.id, content: r.content }));
}

/** Saves a note; returns its id. Ignores empty/duplicate content. */
export async function addMemory(content: string, createdBy: number | null): Promise<number> {
  const clean = content.trim().slice(0, 1000);
  if (!clean) return 0;
  const pool = getPool();
  const [existing] = await pool.query<MemoryRow[]>(
    "SELECT id FROM ai_memory WHERE content = ? LIMIT 1",
    [clean]
  );
  if (existing[0]) return existing[0].id;
  const [res] = await pool.query("INSERT INTO ai_memory (content, created_by) VALUES (?, ?)", [
    clean,
    createdBy,
  ]);
  return (res as { insertId: number }).insertId;
}

/** Deletes a note by id. */
export async function deleteMemory(id: number): Promise<void> {
  await getPool().query("DELETE FROM ai_memory WHERE id = ?", [id]);
}
