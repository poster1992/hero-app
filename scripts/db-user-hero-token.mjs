// Adds users.hero_api_token (personal HERO API token per user). Idempotent.
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
  await conn.query("ALTER TABLE users ADD COLUMN hero_api_token VARCHAR(255) NULL");
  console.log("+ Spalte users.hero_api_token hinzugefügt");
} catch (err) {
  if (err.code === "ER_DUP_FIELDNAME") console.log("= Spalte users.hero_api_token existiert bereits");
  else throw err;
}

console.log("OK: users kann jetzt einen persönlichen HERO-Token je Benutzer speichern.");
await conn.end();
