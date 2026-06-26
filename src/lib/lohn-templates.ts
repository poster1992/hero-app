import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { getPool } from "./db";

/** Eine Vorlagen-Position: Abschlagsbetrag je Mitarbeiter. */
export interface LohnTemplatePosition {
  employeeId: number;
  amount: number;
}

/** Gespeicherte Vorlage für Lohn-Abschläge (Beträge je Mitarbeiter). */
export interface LohnTemplate {
  id: number;
  name: string;
  reference: string | null;
  positions: LohnTemplatePosition[];
  updatedAt: string | null;
}

interface TemplateRow extends RowDataPacket {
  id: number;
  name: string;
  reference: string | null;
  positions: unknown;
  updated_at: string | null;
}

function parsePositions(value: unknown): LohnTemplatePosition[] {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => ({
      employeeId: Number((p as LohnTemplatePosition)?.employeeId ?? 0),
      amount: Number((p as LohnTemplatePosition)?.amount ?? 0),
    }))
    .filter((p) => Number.isFinite(p.employeeId) && p.employeeId > 0);
}

/** Alle Vorlagen, alphabetisch sortiert. */
export async function listLohnTemplates(): Promise<LohnTemplate[]> {
  const [rows] = await getPool().query<TemplateRow[]>(
    "SELECT id, name, reference, positions, updated_at FROM lohn_templates ORDER BY name ASC"
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    reference: r.reference,
    positions: parsePositions(r.positions),
    updatedAt: r.updated_at ? String(r.updated_at) : null,
  }));
}

/** Legt eine Vorlage an oder überschreibt sie (per eindeutigem Namen). */
export async function upsertLohnTemplate(input: {
  name: string;
  reference: string | null;
  positions: LohnTemplatePosition[];
  createdBy: number | null;
}): Promise<void> {
  await getPool().query<ResultSetHeader>(
    `INSERT INTO lohn_templates (name, reference, positions, created_by)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE reference = VALUES(reference), positions = VALUES(positions)`,
    [input.name.slice(0, 160), input.reference?.slice(0, 200) ?? null, JSON.stringify(input.positions), input.createdBy]
  );
}

/** Entfernt eine Vorlage. */
export async function deleteLohnTemplate(id: number): Promise<void> {
  await getPool().query("DELETE FROM lohn_templates WHERE id = ?", [id]);
}
