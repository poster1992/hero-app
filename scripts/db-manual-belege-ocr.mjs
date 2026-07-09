// Ergänzt manual_receipts um einen OCR-Volltext (für die Volltextsuche). Idempotent.
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
const [cols] = await conn.query(
  "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'manual_receipts' AND COLUMN_NAME = 'ocr_text' LIMIT 1",
  [db]
);
if (cols.length === 0) {
  await conn.query("ALTER TABLE manual_receipts ADD COLUMN ocr_text MEDIUMTEXT DEFAULT NULL");
  console.log("+ Spalte ocr_text ergänzt");
} else {
  console.log("ocr_text bereits vorhanden");
}
const [[n]] = await conn.query("SELECT COUNT(*) AS n FROM manual_receipts");
console.log(`manual_receipts bereit – ${n.n} Belege.`);
await conn.end();
