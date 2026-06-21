import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";
import { MODULE_KEYS } from "./modules";

export interface Role {
  key: string;
  label: string;
}

export interface RoleWithCount extends Role {
  userCount: number;
}

interface RoleRow extends RowDataPacket {
  role_key: string;
  label: string;
  sort_order: number;
}

interface CountRow extends RowDataPacket {
  role_key: string;
  label: string;
  user_count: number;
}

/** Builds a url-safe role key from a label (handles German umlauts). */
export function slugifyRole(label: string): string {
  return label
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

export async function listRoles(): Promise<Role[]> {
  const [rows] = await getPool().query<RoleRow[]>(
    "SELECT role_key, label, sort_order FROM roles ORDER BY sort_order, label"
  );
  return rows.map((r) => ({ key: r.role_key, label: r.label }));
}

export async function listRolesWithUserCount(): Promise<RoleWithCount[]> {
  const [rows] = await getPool().query<CountRow[]>(
    `SELECT r.role_key, r.label, COUNT(u.id) AS user_count
     FROM roles r LEFT JOIN users u ON u.role = r.role_key
     GROUP BY r.role_key, r.label, r.sort_order
     ORDER BY r.sort_order, r.label`
  );
  return rows.map((r) => ({ key: r.role_key, label: r.label, userCount: Number(r.user_count) }));
}

export async function roleExists(key: string): Promise<boolean> {
  const [rows] = await getPool().query<RoleRow[]>(
    "SELECT role_key, label, sort_order FROM roles WHERE role_key = ? LIMIT 1",
    [key]
  );
  return rows.length > 0;
}

/** Creates a new role from a label. Returns the generated key, or null on conflict/empty. */
export async function createRole(label: string): Promise<string | null> {
  const clean = label.trim();
  const key = slugifyRole(clean);
  if (!clean || !key) return null;
  const pool = getPool();
  const [maxRows] = await pool.query<RowDataPacket[]>(
    "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM roles"
  );
  const sortOrder = Number((maxRows[0] as { next: number }).next) || 99;
  try {
    await pool.query("INSERT INTO roles (role_key, label, sort_order) VALUES (?, ?, ?)", [
      key,
      clean,
      sortOrder,
    ]);
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ER_DUP_ENTRY") return null;
    throw e;
  }
  return key;
}

/** Deletes a role. Refuses to delete 'administrator' or roles still assigned to users. */
export async function deleteRole(key: string): Promise<{ ok: boolean; error?: string }> {
  if (key === "administrator") return { ok: false, error: "Diese Gruppe kann nicht gelöscht werden." };
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM users WHERE role = ?",
    [key]
  );
  if (Number((rows[0] as { n: number }).n) > 0) {
    return { ok: false, error: "Gruppe ist noch Benutzern zugewiesen." };
  }
  await pool.query("DELETE FROM roles WHERE role_key = ?", [key]);
  await pool.query("DELETE FROM role_permissions WHERE role_key = ?", [key]);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Permissions (which modules a role may see).
// ---------------------------------------------------------------------------

interface PermRow extends RowDataPacket {
  role_key: string;
  module_key: string;
}

/** Module keys granted to a role. Administrator implicitly gets all modules. */
export async function getAllowedModules(roleKey: string): Promise<string[]> {
  if (roleKey === "administrator") return [...MODULE_KEYS, "konfiguration"];
  const [rows] = await getPool().query<PermRow[]>(
    "SELECT module_key FROM role_permissions WHERE role_key = ?",
    [roleKey]
  );
  return rows.map((r) => r.module_key);
}

/** Permission map for all (non-admin) roles: roleKey -> Set of module keys. */
export async function getAllRolePermissions(): Promise<Record<string, string[]>> {
  const [rows] = await getPool().query<PermRow[]>(
    "SELECT role_key, module_key FROM role_permissions"
  );
  const map: Record<string, string[]> = {};
  for (const r of rows) {
    (map[r.role_key] ??= []).push(r.module_key);
  }
  return map;
}

/** Replaces the granted modules for a role (administrator is not restricted). */
export async function setRolePermissions(roleKey: string, modules: string[]): Promise<void> {
  if (roleKey === "administrator") return;
  const allowed = modules.filter((m) => MODULE_KEYS.includes(m));
  const pool = getPool();
  await pool.query("DELETE FROM role_permissions WHERE role_key = ?", [roleKey]);
  if (allowed.length > 0) {
    await pool.query("INSERT INTO role_permissions (role_key, module_key) VALUES ?", [
      allowed.map((m) => [roleKey, m]),
    ]);
  }
}
