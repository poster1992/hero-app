import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { getPool } from "./db";

/** Mitarbeiter mit Bankverbindung für Lohn-Abschläge (eigene Liste, unabhängig von HERO). */
export interface LohnEmployee {
  id: number;
  name: string;
  iban: string;
  bic: string | null;
  active: boolean;
}

interface EmployeeRow extends RowDataPacket {
  id: number;
  name: string;
  iban: string;
  bic: string | null;
  active: number;
}

/** Alle Mitarbeiter (standardmäßig nur aktive), alphabetisch sortiert. */
export async function listLohnEmployees(includeInactive = false): Promise<LohnEmployee[]> {
  const [rows] = await getPool().query<EmployeeRow[]>(
    `SELECT id, name, iban, bic, active FROM lohn_employees
     ${includeInactive ? "" : "WHERE active = 1"}
     ORDER BY name ASC`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    iban: r.iban,
    bic: r.bic,
    active: r.active === 1,
  }));
}

/** Legt einen Mitarbeiter an oder aktualisiert ihn (per id). Gibt die id zurück. */
export async function upsertLohnEmployee(input: {
  id?: number | null;
  name: string;
  iban: string;
  bic: string | null;
}): Promise<number> {
  const pool = getPool();
  if (input.id) {
    await pool.query(
      "UPDATE lohn_employees SET name = ?, iban = ?, bic = ? WHERE id = ?",
      [input.name, input.iban, input.bic, input.id]
    );
    return input.id;
  }
  const [res] = await pool.query<ResultSetHeader>(
    "INSERT INTO lohn_employees (name, iban, bic) VALUES (?, ?, ?)",
    [input.name, input.iban, input.bic]
  );
  return res.insertId;
}

/** Entfernt einen Mitarbeiter aus der Liste. */
export async function deleteLohnEmployee(id: number): Promise<void> {
  await getPool().query("DELETE FROM lohn_employees WHERE id = ?", [id]);
}
