// Adds an email column to users (for notifications). Idempotent.
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";

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

const e = loadEnv();
const conn = await mysql.createConnection({
  host: e.MYSQL_HOST,
  port: e.MYSQL_PORT ? parseInt(e.MYSQL_PORT, 10) : 3306,
  database: e.MYSQL_DATABASE,
  user: e.MYSQL_USER,
  password: e.MYSQL_PASSWORD ?? "",
});

try {
  await conn.query("ALTER TABLE users ADD COLUMN email VARCHAR(190) NULL");
  console.log("+ Spalte email hinzugefügt");
} catch (err) {
  if (err.code === "ER_DUP_FIELDNAME") console.log("= Spalte email existiert bereits");
  else throw err;
}

// Bestehende Logins, deren Benutzername eine E-Mail ist, als E-Mail übernehmen.
await conn.query(
  "UPDATE users SET email = username WHERE (email IS NULL OR email = '') AND username LIKE '%@%'"
);

console.log("OK: users.email bereit.");
await conn.end();
