import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

// Eigenständiger, abgekapselter Ablageort – unabhängig von den HERO-Belegen.
// Liegt im selben persistenten Volume wie die übrigen Uploads (eigener Unterordner).
const BELEGE_DIR = process.env.BELEGE_DIR || path.join(process.cwd(), "data", "belege");
const BAUSTELLEN_BELEGE_DIR =
  process.env.BAUSTELLEN_BELEGE_DIR || path.join(BELEGE_DIR, "baustellen-belege");

export interface BaustellenBeleg {
  id: number;
  fileName: string;
  mime: string | null;
  size: number | null;
  uploadedByName: string | null;
  uploadedAt: string | null;
}

interface Row extends RowDataPacket {
  id: number;
  file_name: string;
  mime: string | null;
  size: number | null;
  uploaded_by_name: string | null;
  uploaded_at: string | null;
}

/** Belege eines Baustellen-Ordners (neueste zuerst). */
export async function listBaustellenBelege(baustelleId: number): Promise<BaustellenBeleg[]> {
  const [rows] = await getPool().query<Row[]>(
    `SELECT b.id, b.file_name, b.mime, b.size, b.uploaded_at,
            COALESCE(NULLIF(u.display_name, ''), u.username) AS uploaded_by_name
       FROM baustellen_belege b
       LEFT JOIN users u ON u.id = b.uploaded_by
      WHERE b.baustelle_id = ?
      ORDER BY b.id DESC`,
    [baustelleId]
  );
  return rows.map((r) => ({
    id: r.id,
    fileName: r.file_name,
    mime: r.mime,
    size: r.size == null ? null : Number(r.size),
    uploadedByName: r.uploaded_by_name,
    uploadedAt: r.uploaded_at ? String(r.uploaded_at) : null,
  }));
}

/** Lädt einen Beleg zu einem Baustellen-Ordner hoch. */
export async function addBaustellenBeleg(
  baustelleId: number,
  file: { buffer: Buffer; originalName: string; mime: string },
  uploadedBy: number | null
): Promise<void> {
  await mkdir(BAUSTELLEN_BELEGE_DIR, { recursive: true });
  const ext = path.extname(file.originalName) || "";
  const storedName = `${randomUUID()}${ext}`;
  await writeFile(path.join(BAUSTELLEN_BELEGE_DIR, storedName), file.buffer);
  await getPool().query(
    `INSERT INTO baustellen_belege (baustelle_id, file_name, stored_name, mime, size, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [baustelleId, file.originalName.slice(0, 255), storedName, file.mime, file.buffer.length, uploadedBy]
  );
}

/** Liefert eine Beleg-Datei zum Anzeigen/Download. */
export async function getBaustellenBelegFile(
  id: number
): Promise<{ data: Buffer; mime: string; name: string } | null> {
  const [rows] = await getPool().query<(Row & { stored_name: string })[]>(
    "SELECT file_name, stored_name, mime FROM baustellen_belege WHERE id = ? LIMIT 1",
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  try {
    const data = await readFile(path.join(BAUSTELLEN_BELEGE_DIR, row.stored_name));
    return { data, mime: row.mime || "application/octet-stream", name: row.file_name };
  } catch {
    return null;
  }
}

/** Entfernt einen Beleg (DB-Eintrag + Datei). */
export async function deleteBaustellenBeleg(id: number): Promise<void> {
  const pool = getPool();
  const [rows] = await pool.query<(Row & { stored_name: string })[]>(
    "SELECT stored_name FROM baustellen_belege WHERE id = ? LIMIT 1",
    [id]
  );
  const stored = rows[0]?.stored_name ?? null;
  await pool.query("DELETE FROM baustellen_belege WHERE id = ?", [id]);
  if (stored) {
    try {
      await unlink(path.join(BAUSTELLEN_BELEGE_DIR, stored));
    } catch {
      // Datei evtl. schon weg – ignorieren.
    }
  }
}
