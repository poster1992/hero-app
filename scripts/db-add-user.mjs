// Adds (or updates the password of) a login user.
// Usage: node scripts/db-add-user.mjs <username> <password> [role] [displayName]
//   role default: "admin"
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";

function loadEnv() {
  const env = {};
  try {
    const text = readFileSync(new URL("../.env", import.meta.url), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
  return env;
}

const [username, password, role = "admin", displayName = null] = process.argv.slice(2);
if (!username || !password) {
  console.error("Usage: node scripts/db-add-user.mjs <username> <password> [role] [displayName]");
  process.exit(1);
}

const e = loadEnv();
const conn = await mysql.createConnection({
  host: e.MYSQL_HOST,
  port: e.MYSQL_PORT ? parseInt(e.MYSQL_PORT, 10) : 3306,
  database: e.MYSQL_DATABASE,
  user: e.MYSQL_USER,
  password: e.MYSQL_PASSWORD ?? "",
});

const hash = await bcrypt.hash(password, 10);
await conn.query(
  `INSERT INTO users (username, password_hash, display_name, role, is_active)
   VALUES (?, ?, ?, ?, 1)
   ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash),
     display_name = VALUES(display_name), role = VALUES(role), is_active = 1`,
  [username, hash, displayName, role]
);
console.log(`OK: Benutzer '${username}' (Rolle: ${role}) angelegt/aktualisiert.`);
await conn.end();
