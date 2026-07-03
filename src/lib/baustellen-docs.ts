import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { getPool } from "./db";
import { findProjectByNr } from "./hero-api";

/** Ein konfigurierter Baustellen-Doku-Ordner (Menüpunkt) zu einem HERO-Projekt. */
export interface BaustelleDoc {
  id: number;
  label: string;
  projectMatchId: number;
  projectNr: string;
  projectName: string;
  imageCategory: string;
}

interface Row extends RowDataPacket {
  id: number;
  label: string;
  project_match_id: number;
  project_nr: string;
  project_name: string;
  image_category: string;
}

/** Alle konfigurierten Baustellen-Ordner (nach Sortierung/Label). */
export async function listBaustellen(): Promise<BaustelleDoc[]> {
  const [rows] = await getPool().query<Row[]>(
    `SELECT id, label, project_match_id, project_nr, project_name, image_category
       FROM baustellen_docs ORDER BY sort_order ASC, label ASC`
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    projectMatchId: r.project_match_id,
    projectNr: r.project_nr,
    projectName: r.project_name,
    imageCategory: r.image_category,
  }));
}

/** Einzelnen Ordner laden (für die Galerie-Seite). */
export async function getBaustelle(id: number): Promise<BaustelleDoc | null> {
  const [rows] = await getPool().query<Row[]>(
    `SELECT id, label, project_match_id, project_nr, project_name, image_category
       FROM baustellen_docs WHERE id = ? LIMIT 1`,
    [id]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    label: r.label,
    projectMatchId: r.project_match_id,
    projectNr: r.project_nr,
    projectName: r.project_name,
    imageCategory: r.image_category,
  };
}

/**
 * Fügt einen Baustellen-Ordner hinzu. Löst die Projektnummer über HERO auf
 * (holt project_match_id + Projektname). Gibt eine Fehlermeldung oder null zurück.
 */
export async function addBaustelle(input: {
  label: string;
  projectNr: string;
  imageCategory?: string;
}): Promise<{ error?: string }> {
  const label = input.label.trim();
  const projectNr = input.projectNr.trim();
  const category = (input.imageCategory ?? "").trim() || "Dokumentation";
  if (!label) return { error: "Bitte einen Namen für den Menüpunkt angeben." };
  if (!projectNr) return { error: "Bitte eine Projektnummer angeben (z. B. PRJ-199)." };

  let resolved: Awaited<ReturnType<typeof findProjectByNr>>;
  try {
    resolved = await findProjectByNr(projectNr);
  } catch (e) {
    return { error: e instanceof Error ? `HERO-Fehler: ${e.message}` : "HERO nicht erreichbar." };
  }
  if (!resolved) return { error: `Projekt „${projectNr}" wurde in HERO nicht gefunden.` };

  const pool = getPool();
  const [maxRows] = await pool.query<RowDataPacket[]>(
    "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM baustellen_docs"
  );
  const sortOrder = Number((maxRows[0] as { next: number }).next) || 1;
  await pool.query<ResultSetHeader>(
    `INSERT INTO baustellen_docs (label, project_match_id, project_nr, project_name, image_category, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [label.slice(0, 120), resolved.projectMatchId, resolved.projectNr, resolved.name, category.slice(0, 120), sortOrder]
  );
  return {};
}

/** Entfernt einen Baustellen-Ordner. */
export async function deleteBaustelle(id: number): Promise<void> {
  await getPool().query("DELETE FROM baustellen_docs WHERE id = ?", [id]);
}
