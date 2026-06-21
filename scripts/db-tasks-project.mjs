// Adds project reference columns to tasks (HERO project snapshot). Idempotent.
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

async function addColumn(sql, name) {
  try {
    await conn.query(sql);
    console.log(`+ Spalte ${name} hinzugefügt`);
  } catch (err) {
    if (err.code === "ER_DUP_FIELDNAME") console.log(`= Spalte ${name} existiert bereits`);
    else throw err;
  }
}

await addColumn("ALTER TABLE tasks ADD COLUMN project_id INT NULL", "project_id");
await addColumn("ALTER TABLE tasks ADD COLUMN project_relative_id INT NULL", "project_relative_id");
await addColumn("ALTER TABLE tasks ADD COLUMN project_name VARCHAR(255) NULL", "project_name");

console.log("OK: tasks um Projektzuordnung erweitert.");
await conn.end();
