// Links local stock to HERO articles: adds materials.hero_article_id (unique). Idempotent.
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
  await conn.query("ALTER TABLE materials ADD COLUMN hero_article_id INT NULL");
  console.log("+ Spalte hero_article_id hinzugefügt");
} catch (err) {
  if (err.code === "ER_DUP_FIELDNAME") console.log("= Spalte hero_article_id existiert bereits");
  else throw err;
}

try {
  await conn.query("ALTER TABLE materials ADD UNIQUE KEY uq_hero_article (hero_article_id)");
  console.log("+ Unique-Index uq_hero_article hinzugefügt");
} catch (err) {
  if (err.code === "ER_DUP_KEYNAME") console.log("= Unique-Index existiert bereits");
  else throw err;
}

console.log("OK: materials mit HERO-Artikel verknüpft.");
await conn.end();
