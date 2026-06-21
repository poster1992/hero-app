// Extends stock_movements with project + employee + direction context. Idempotent.
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

await addCol("ALTER TABLE stock_movements ADD COLUMN project_relative_id INT NULL", "project_relative_id");
await addCol("ALTER TABLE stock_movements ADD COLUMN project_name VARCHAR(255) NULL", "project_name");
await addCol("ALTER TABLE stock_movements ADD COLUMN employee_name VARCHAR(190) NULL", "employee_name");
await addCol("ALTER TABLE stock_movements ADD COLUMN direction VARCHAR(10) NULL", "direction");

console.log("OK: stock_movements erweitert.");
await conn.end();
