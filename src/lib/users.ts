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
}

interface UserRow extends RowDataPacket {
  id: number;
  username: string;
  password_hash: string;
  display_name: string | null;
  email: string | null;
  role: string;
  is_active: number;
}

const USER_COLUMNS =
  "id, username, password_hash, display_name, email, role, is_active";

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
  };
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

/** Activates or deactivates a user. */
export async function setUserActive(id: number, active: boolean): Promise<void> {
  await getPool().query<ResultSetHeader>("UPDATE users SET is_active = ? WHERE id = ?", [
    active ? 1 : 0,
    id,
  ]);
}
