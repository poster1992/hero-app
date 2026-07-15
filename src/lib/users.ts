import type { RowDataPacket, ResultSetHeader } from "mysql2";
import bcrypt from "bcryptjs";
import { getPool } from "./db";

export interface AppUser {
  id: number;
  username: string;
  displayName: string | null;
  email: string | null;
  role: string;
  isActive: boolean;
  /** true, wenn ein persönlicher HERO-API-Token hinterlegt ist (der Token selbst wird NIE ausgegeben). */
  hasHeroToken: boolean;
}

interface UserRow extends RowDataPacket {
  id: number;
  username: string;
  password_hash: string;
  display_name: string | null;
  email: string | null;
  role: string;
  is_active: number;
  hero_api_token: string | null;
}

const USER_COLUMNS =
  "id, username, password_hash, display_name, email, role, is_active, hero_api_token";

/** Best email for a user: explicit email, else username if it looks like one. */
export function userEmail(u: { email: string | null; username: string }): string | null {
  if (u.email && u.email.includes("@")) return u.email;
  if (u.username.includes("@")) return u.username;
  return null;
}

/**
 * Verifies a username/password against the `users` table.
 * Returns the user on success, or null on unknown user / wrong password /
 * deactivated account. The bcrypt compare runs even for unknown users to
 * avoid leaking which usernames exist (timing).
 */
export async function authenticateUser(
  username: string,
  password: string
): Promise<AppUser | null> {
  const [rows] = await getPool().query<UserRow[]>(
    `SELECT ${USER_COLUMNS} FROM users WHERE username = ? LIMIT 1`,
    [username]
  );
  const row = rows[0];

  // Always run a compare to keep timing constant for unknown users.
  const hash = row?.password_hash ?? "$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv";
  const ok = await bcrypt.compare(password, hash);

  if (!row || !ok || row.is_active !== 1) return null;

  return toAppUser(row);
}

function toAppUser(row: UserRow): AppUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    isActive: row.is_active === 1,
    hasHeroToken: !!row.hero_api_token && row.hero_api_token.trim().length > 0,
  };
}

/**
 * Der persönliche HERO-API-Token eines Benutzers (oder null). NUR serverseitig
 * verwenden – dieser Wert darf niemals an den Client gelangen (deshalb nicht Teil
 * von AppUser). Wird von currentHeroToken() genutzt, damit HERO-Aktionen unter dem
 * echten Benutzer laufen.
 */
export async function getUserHeroToken(username: string): Promise<string | null> {
  const [rows] = await getPool().query<UserRow[]>(
    "SELECT hero_api_token FROM users WHERE username = ? AND is_active = 1 LIMIT 1",
    [username]
  );
  const t = rows[0]?.hero_api_token?.trim();
  return t && t.length > 0 ? t : null;
}

/** Setzt oder löscht (leerer String) den persönlichen HERO-Token eines Benutzers. */
export async function setUserHeroToken(id: number, token: string | null): Promise<void> {
  const value = token && token.trim().length > 0 ? token.trim() : null;
  await getPool().query("UPDATE users SET hero_api_token = ? WHERE id = ?", [value, id]);
}

/** Looks up a user by username (without password hash), or null. */
export async function getUserByUsername(username: string): Promise<AppUser | null> {
  const [rows] = await getPool().query<UserRow[]>(
    `SELECT ${USER_COLUMNS} FROM users WHERE username = ? LIMIT 1`,
    [username]
  );
  return rows[0] ? toAppUser(rows[0]) : null;
}

/** All users (without password hashes), ordered by username. */
export async function listUsers(): Promise<AppUser[]> {
  const [rows] = await getPool().query<UserRow[]>(
    `SELECT ${USER_COLUMNS} FROM users ORDER BY username`
  );
  return rows.map(toAppUser);
}

/** Resolves notification emails for a set of user ids. */
export async function getUsersForNotification(
  ids: number[]
): Promise<{ id: number; name: string; email: string | null }[]> {
  if (ids.length === 0) return [];
  const [rows] = await getPool().query<UserRow[]>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id IN (?)`,
    [ids]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.display_name || r.username,
    email: userEmail(r),
  }));
}

/** Active administrator user ids (for system-generated tasks/notifications). */
export async function listAdminUserIds(): Promise<number[]> {
  const [rows] = await getPool().query<UserRow[]>(
    "SELECT id FROM users WHERE role = 'administrator' AND is_active = 1"
  );
  return rows.map((r) => r.id);
}

/** Creates a new user. Throws ER_DUP_ENTRY if the username already exists. */
export async function createUser(input: {
  username: string;
  password: string;
  role: string;
  displayName: string | null;
  email: string | null;
}): Promise<void> {
  const hash = await bcrypt.hash(input.password, 10);
  await getPool().query(
    "INSERT INTO users (username, password_hash, display_name, email, role, is_active) VALUES (?, ?, ?, ?, ?, 1)",
    [input.username, hash, input.displayName, input.email, input.role]
  );
}

/** Sets (resets) a user's password to a new value. */
export async function setUserPassword(id: number, password: string): Promise<void> {
  const hash = await bcrypt.hash(password, 10);
  await getPool().query<ResultSetHeader>("UPDATE users SET password_hash = ? WHERE id = ?", [
    hash,
    id,
  ]);
}

/** Changes a user's role (rights group). */
export async function setUserRole(id: number, role: string): Promise<void> {
  await getPool().query<ResultSetHeader>("UPDATE users SET role = ? WHERE id = ?", [role, id]);
}

/** Activates or deactivates a user. */
export async function setUserActive(id: number, active: boolean): Promise<void> {
  await getPool().query<ResultSetHeader>("UPDATE users SET is_active = ? WHERE id = ?", [
    active ? 1 : 0,
    id,
  ]);
}
