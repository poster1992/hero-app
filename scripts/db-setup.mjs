// Creates the `users` table in the configured MySQL database (idempotent).
// Usage: node scripts/db-setup.mjs   (reads MYSQL_* from .env)
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
if (!e.MYSQL_HOST || !e.MYSQL_DATABASE || !e.MYSQL_USER) {
  console.error("MYSQL_HOST/MYSQL_DATABASE/MYSQL_USER fehlen in .env.");
  process.exit(1);
}

const conn = await mysql.createConnection({
  host: e.MYSQL_HOST,
  port: e.MYSQL_PORT ? parseInt(e.MYSQL_PORT, 10) : 3306,
  database: e.MYSQL_DATABASE,
  user: e.MYSQL_USER,
  password: e.MYSQL_PASSWORD ?? "",
});

await conn.query(`
  CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(190) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(190) NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'user',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);

const [rows] = await conn.query("SELECT COUNT(*) AS n FROM users");
console.log(`OK: Tabelle 'users' bereit. Vorhandene Benutzer: ${rows[0].n}`);
await conn.end();
