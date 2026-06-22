// Adds a per-movement EK snapshot to stock_movements. Idempotent.
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
  await conn.query("ALTER TABLE stock_movements ADD COLUMN ek_price DECIMAL(12,4) NULL");
  console.log("+ stock_movements.ek_price");
} catch (err) {
  if (err.code === "ER_DUP_FIELDNAME") console.log("= ek_price existiert bereits");
  else throw err;
}

// Bestehende Buchungen einmalig mit aktuellem Materialpreis befüllen (Annahme).
const [res] = await conn.query(
  `UPDATE stock_movements mv JOIN materials m ON m.id = mv.material_id
      SET mv.ek_price = m.ek_price
    WHERE mv.ek_price IS NULL`
);
console.log(`= ${res.affectedRows} bestehende Buchungen mit EK befüllt`);

console.log("OK: stock_movements um EK-Snapshot erweitert.");
await conn.end();
