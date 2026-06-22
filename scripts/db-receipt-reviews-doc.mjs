// Adds the document URL to receipt_reviews (for the review task). Idempotent.
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
  await conn.query("ALTER TABLE receipt_reviews ADD COLUMN doc_url VARCHAR(512) NULL");
  console.log("+ receipt_reviews.doc_url");
} catch (err) {
  if (err.code === "ER_DUP_FIELDNAME") console.log("= doc_url existiert bereits");
  else throw err;
}

console.log("OK.");
await conn.end();
