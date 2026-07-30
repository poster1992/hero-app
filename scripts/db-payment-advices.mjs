// Legt die Tabelle payment_advices an (Zahlungsavise vom Lieferanten – reine
// Speicherung + späterer Export, keine Buchung). Idempotent.
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
  CREATE TABLE IF NOT EXISTS payment_advices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    year INT NOT NULL,
    month INT NOT NULL,
    supplier VARCHAR(191) NULL,
    note VARCHAR(255) NULL,
    file_name VARCHAR(255) NULL,
    stored_name VARCHAR(255) NOT NULL,
    mime VARCHAR(100) NULL,
    uploaded_by INT NULL,
    created DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_payment_advices_period (year, month)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);

const [[n]] = await conn.query("SELECT COUNT(*) AS n FROM payment_advices");
console.log(`payment_advices bereit – ${n.n} Avise.`);
await conn.end();
