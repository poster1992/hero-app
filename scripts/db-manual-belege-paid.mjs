// Adds payment status to manual_receipts (is_paid, paid_date). Idempotent.
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

async function addCol(sql, name) {
  try {
    await conn.query(sql);
    console.log(`+ ${name}`);
  } catch (err) {
    if (err.code === "ER_DUP_FIELDNAME") console.log(`= ${name} existiert bereits`);
    else throw err;
  }
}

await addCol("ALTER TABLE manual_receipts ADD COLUMN is_paid TINYINT(1) NOT NULL DEFAULT 0", "is_paid");
await addCol("ALTER TABLE manual_receipts ADD COLUMN paid_date DATE NULL", "paid_date");

console.log("OK: manual_receipts um Bezahlt-Status erweitert.");
await conn.end();
