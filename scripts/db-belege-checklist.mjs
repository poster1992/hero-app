// Creates the monthly receipt checklist tables. Idempotent.
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

await conn.query(`
  CREATE TABLE IF NOT EXISTS belege_checklist_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    label VARCHAR(255) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);
console.log("= belege_checklist_items");

await conn.query(`
  CREATE TABLE IF NOT EXISTS belege_checklist_status (
    item_id INT NOT NULL,
    year INT NOT NULL,
    month INT NOT NULL,
    done TINYINT(1) NOT NULL DEFAULT 0,
    done_at TIMESTAMP NULL,
    PRIMARY KEY (item_id, year, month),
    CONSTRAINT fk_checklist_item FOREIGN KEY (item_id)
      REFERENCES belege_checklist_items (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);
console.log("= belege_checklist_status");

console.log("OK: Beleg-Checkliste eingerichtet.");
await conn.end();
