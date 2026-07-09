// Ergänzt manual_receipts um source (Herkunft) und created (Erfassungszeitpunkt).
// Idempotent (prüft Spalten über information_schema).
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

const db = e.MYSQL_DATABASE;
async function hasColumn(col) {
  const [rows] = await conn.query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'manual_receipts' AND COLUMN_NAME = ? LIMIT 1",
    [db, col]
  );
  return rows.length > 0;
}

if (!(await hasColumn("source"))) {
  await conn.query("ALTER TABLE manual_receipts ADD COLUMN source VARCHAR(16) NOT NULL DEFAULT 'form'");
  console.log("+ Spalte source ergänzt");
}
if (!(await hasColumn("created"))) {
  await conn.query("ALTER TABLE manual_receipts ADD COLUMN created DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
  console.log("+ Spalte created ergänzt");
}
if (!(await hasColumn("__idx_check_src"))) {
  // Index auf source für die Posteingang-Abfrage (nur wenn nicht vorhanden).
  const [idx] = await conn.query(
    "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'manual_receipts' AND INDEX_NAME = 'idx_manual_receipts_source' LIMIT 1",
    [db]
  );
  if (idx.length === 0) {
    await conn.query("ALTER TABLE manual_receipts ADD INDEX idx_manual_receipts_source (source)");
    console.log("+ Index idx_manual_receipts_source ergänzt");
  }
}

const [[n]] = await conn.query("SELECT COUNT(*) AS n FROM manual_receipts");
console.log(`manual_receipts bereit – ${n.n} Belege.`);
await conn.end();
