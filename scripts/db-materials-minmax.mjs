// Ergänzt materials um min_stock/max_stock (Lager-Minimum/-Maximum je Artikel). Idempotent.
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
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'materials' AND COLUMN_NAME = ? LIMIT 1",
    [db, col]
  );
  return rows.length > 0;
}
if (!(await hasColumn("min_stock"))) {
  await conn.query("ALTER TABLE materials ADD COLUMN min_stock DECIMAL(12,2) DEFAULT NULL");
  console.log("+ Spalte min_stock ergänzt");
}
if (!(await hasColumn("max_stock"))) {
  await conn.query("ALTER TABLE materials ADD COLUMN max_stock DECIMAL(12,2) DEFAULT NULL");
  console.log("+ Spalte max_stock ergänzt");
}
console.log("materials min/max bereit.");
await conn.end();
