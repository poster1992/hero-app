// Legt die Tabelle review_emails an bzw. ergänzt Kunden-Spalten (customer_id,
// customer_name) für die Kundenbewertungs-Seite. Idempotent (MariaDB/MySQL).
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
  CREATE TABLE IF NOT EXISTS review_emails (
    project_key VARCHAR(191) NOT NULL,
    customer_email VARCHAR(255) DEFAULT NULL,
    task_id INT DEFAULT NULL,
    sent_by INT DEFAULT NULL,
    sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    customer_id VARCHAR(64) DEFAULT NULL,
    customer_name VARCHAR(191) DEFAULT NULL,
    PRIMARY KEY (project_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
`);

// Spalten für bestehende Tabellen nachrüsten (Spalten-Existenz prüfen, portabel).
const db = e.MYSQL_DATABASE;
async function hasColumn(col) {
  const [rows] = await conn.query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'review_emails' AND COLUMN_NAME = ? LIMIT 1",
    [db, col]
  );
  return rows.length > 0;
}
async function hasIndex(idx) {
  const [rows] = await conn.query(
    "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'review_emails' AND INDEX_NAME = ? LIMIT 1",
    [db, idx]
  );
  return rows.length > 0;
}

if (!(await hasColumn("customer_id"))) {
  await conn.query("ALTER TABLE review_emails ADD COLUMN customer_id VARCHAR(64) DEFAULT NULL");
  console.log("+ Spalte customer_id ergänzt");
}
if (!(await hasColumn("customer_name"))) {
  await conn.query("ALTER TABLE review_emails ADD COLUMN customer_name VARCHAR(191) DEFAULT NULL");
  console.log("+ Spalte customer_name ergänzt");
}
if (!(await hasIndex("idx_review_customer_id"))) {
  await conn.query("ALTER TABLE review_emails ADD INDEX idx_review_customer_id (customer_id)");
  console.log("+ Index idx_review_customer_id ergänzt");
}
if (!(await hasIndex("idx_review_customer_email"))) {
  await conn.query("ALTER TABLE review_emails ADD INDEX idx_review_customer_email (customer_email)");
  console.log("+ Index idx_review_customer_email ergänzt");
}

const [n] = await conn.query("SELECT COUNT(*) AS n FROM review_emails");
console.log(`review_emails bereit – ${n[0].n} Einträge.`);
await conn.end();
