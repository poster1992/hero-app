// History for the invoice review (Rechnungsprüfung). Idempotent.
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

await conn.query(`
  CREATE TABLE IF NOT EXISTS receipt_review_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hero_receipt_id VARCHAR(64) NOT NULL,
    user_id INT NULL,
    action VARCHAR(30) NOT NULL,
    detail TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_hero (hero_receipt_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);
console.log("= receipt_review_history");
console.log("OK: Prüf-Historie eingerichtet.");
await conn.end();
