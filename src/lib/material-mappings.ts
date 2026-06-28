import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

/** Normalisierter Artikel-Schlüssel – identisch zur Logik im Projekt-Popup (normKey). */
export function materialKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

export interface MaterialMapping {
  istKey: string;
  istName: string | null;
  sollKey: string;
  sollName: string | null;
}

interface MappingRow extends RowDataPacket {
  ist_key: string;
  ist_name: string | null;
  soll_key: string;
  soll_name: string | null;
}

/** Manuelle Soll/Ist-Zuordnungen eines Projekts (ist_key → Ziel-Soll). */
export async function getMaterialMappings(projectMatchId: number): Promise<MaterialMapping[]> {
  const [rows] = await getPool().query<MappingRow[]>(
    "SELECT ist_key, ist_name, soll_key, soll_name FROM material_mappings WHERE project_match_id = ?",
    [projectMatchId]
  );
  return rows.map((r) => ({
    istKey: r.ist_key,
    istName: r.ist_name,
    sollKey: r.soll_key,
    sollName: r.soll_name,
  }));
}

/** Legt eine manuelle Zuordnung an oder überschreibt sie (je ist_key). */
export async function setMaterialMapping(input: {
  projectMatchId: number;
  istName: string;
  sollName: string;
  userId: number | null;
}): Promise<void> {
  const istKey = materialKey(input.istName);
  const sollKey = materialKey(input.sollName);
  if (!istKey || !sollKey) return;
  await getPool().query(
    `INSERT INTO material_mappings (project_match_id, ist_key, ist_name, soll_key, soll_name, created_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE ist_name = VALUES(ist_name), soll_key = VALUES(soll_key),
       soll_name = VALUES(soll_name), created_by = VALUES(created_by)`,
    [input.projectMatchId, istKey, input.istName.slice(0, 255), sollKey, input.sollName.slice(0, 255), input.userId]
  );
}

/** Entfernt eine manuelle Zuordnung (per ist_key). */
export async function deleteMaterialMapping(projectMatchId: number, istName: string): Promise<void> {
  await getPool().query("DELETE FROM material_mappings WHERE project_match_id = ? AND ist_key = ?", [
    projectMatchId,
    materialKey(istName),
  ]);
}

/** Entfernt ALLE manuellen Zuordnungen eines Projekts. */
export async function deleteAllMaterialMappings(projectMatchId: number): Promise<void> {
  await getPool().query("DELETE FROM material_mappings WHERE project_match_id = ?", [projectMatchId]);
}

// --- Entfernte (ausgeblendete) Beleg-Artikel ---

/** ist_keys der für dieses Projekt aus dem Ist entfernten Beleg-Artikel. */
export async function getMaterialExcludes(projectMatchId: number): Promise<Set<string>> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT ist_key FROM material_excludes WHERE project_match_id = ?",
    [projectMatchId]
  );
  return new Set((rows as { ist_key: string }[]).map((r) => r.ist_key));
}

/** Blendet einen Beleg-Artikel aus dem Ist aus. */
export async function addMaterialExclude(
  projectMatchId: number,
  istName: string,
  userId: number | null
): Promise<void> {
  const key = materialKey(istName);
  if (!key) return;
  await getPool().query(
    `INSERT INTO material_excludes (project_match_id, ist_key, ist_name, created_by)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE ist_name = VALUES(ist_name)`,
    [projectMatchId, key, istName.slice(0, 255), userId]
  );
}

/** Macht das Ausblenden eines Beleg-Artikels rückgängig. */
export async function removeMaterialExclude(projectMatchId: number, istName: string): Promise<void> {
  await getPool().query("DELETE FROM material_excludes WHERE project_match_id = ? AND ist_key = ?", [
    projectMatchId,
    materialKey(istName),
  ]);
}

/** Entfernt ALLE Ausblendungen eines Projekts. */
export async function deleteAllMaterialExcludes(projectMatchId: number): Promise<void> {
  await getPool().query("DELETE FROM material_excludes WHERE project_match_id = ?", [projectMatchId]);
}
