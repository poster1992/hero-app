// Vergrößert vehicles.note auf TEXT (mehrzeilige Notiz je Fahrzeug). Idempotent.
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
const [rows] = await conn.query(
  "SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'vehicles' AND COLUMN_NAME = 'note' LIMIT 1",
  [db]
);
const type = rows[0]?.DATA_TYPE?.toLowerCase();
if (type !== "text" && type !== "mediumtext" && type !== "longtext") {
  await conn.query("ALTER TABLE vehicles MODIFY note TEXT DEFAULT NULL");
  console.log(`note von ${type ?? "?"} auf TEXT geändert`);
} else {
  console.log(`note bereits ${type}`);
}
await conn.end();
