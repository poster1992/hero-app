import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { getPool } from "./db";

export type DocKind = "arbeitsvertrag" | "personalfragebogen";

export interface SavedContract {
  id: number;
  kind: DocKind;
  employeeName: string;
  /** Personalisierte Feldwerte (Formular-Snapshot). */
  data: Record<string, unknown>;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string | null;
}

interface ContractRow extends RowDataPacket {
  id: number;
  kind: string;
  employee_name: string;
  data: unknown;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string | null;
}

function mapRow(r: ContractRow): SavedContract {
  let data: Record<string, unknown> = {};
  if (r.data && typeof r.data === "object") data = r.data as Record<string, unknown>;
  else if (typeof r.data === "string") {
    try {
      data = JSON.parse(r.data);
    } catch {
      data = {};
    }
  }
  return {
    id: r.id,
    kind: r.kind === "personalfragebogen" ? "personalfragebogen" : "arbeitsvertrag",
    employeeName: r.employee_name,
    data,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: r.created_at ? String(r.created_at) : null,
  };
}

export async function listContracts(): Promise<SavedContract[]> {
  const [rows] = await getPool().query<ContractRow[]>(
    `SELECT c.id, c.kind, c.employee_name, c.data, c.created_by, c.created_at,
            COALESCE(NULLIF(u.display_name, ''), u.username) AS created_by_name
       FROM employment_contracts c
       LEFT JOIN users u ON u.id = c.created_by
      ORDER BY c.id DESC`
  );
  return rows.map(mapRow);
}

export async function createContract(input: {
  kind: DocKind;
  employeeName: string;
  data: Record<string, unknown>;
  createdBy: number | null;
}): Promise<number> {
  const [res] = await getPool().query<ResultSetHeader>(
    "INSERT INTO employment_contracts (kind, employee_name, data, created_by) VALUES (?, ?, ?, ?)",
    [input.kind, input.employeeName.slice(0, 255) || "Unbenannt", JSON.stringify(input.data), input.createdBy]
  );
  return res.insertId;
}

export async function deleteContract(id: number): Promise<void> {
  await getPool().query("DELETE FROM employment_contracts WHERE id = ?", [id]);
}
