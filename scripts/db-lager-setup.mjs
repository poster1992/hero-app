// Creates the warehouse tables: materials + stock_movements. Idempotent.
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
  CREATE TABLE IF NOT EXISTS materials (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(100) NULL,
    unit VARCHAR(20) NOT NULL DEFAULT 'Stk',
    quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
    min_stock DECIMAL(12,2) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_mat_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);

await conn.query(`
  CREATE TABLE IF NOT EXISTS stock_movements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    material_id INT NOT NULL,
    delta DECIMAL(12,2) NOT NULL,
    comment VARCHAR(255) NULL,
    user_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_mov_material (material_id),
    INDEX idx_mov_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);

const [m] = await conn.query("SELECT COUNT(*) AS n FROM materials");
console.log(`OK: Lager-Tabellen bereit. Materialien: ${m[0].n}`);
await conn.end();
