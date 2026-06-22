// Creates manual_receipts (lokale Belege, unabhängig von HERO). Idempotent.
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
  CREATE TABLE IF NOT EXISTS manual_receipts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    beleg_date DATE NULL,
    supplier VARCHAR(255) NULL,
    description VARCHAR(500) NULL,
    gross DECIMAL(12,2) NOT NULL DEFAULT 0,
    vat_rate DECIMAL(5,2) NULL,
    account_number VARCHAR(20) NULL,
    account_name VARCHAR(255) NULL,
    file_name VARCHAR(255) NULL,
    stored_name VARCHAR(255) NULL,
    mime VARCHAR(100) NULL,
    uploaded_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_mr_date (beleg_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);

const [rows] = await conn.query("SELECT COUNT(*) AS n FROM manual_receipts");
console.log(`OK: Tabelle 'manual_receipts' bereit. Einträge: ${rows[0].n}`);
await conn.end();
