// Creates role_permissions (which modules each role may see) and seeds existing
// non-admin roles with all modules except 'konfiguration'. Idempotent.
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
  CREATE TABLE IF NOT EXISTS role_permissions (
    role_key VARCHAR(50) NOT NULL,
    module_key VARCHAR(50) NOT NULL,
    PRIMARY KEY (role_key, module_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);

const DEFAULT_MODULES = [
  "dashboard",
  "projekte",
  "dokumente",
  "lager",
  "kunden",
  "aufgaben",
  "cockpit",
  "arbeitsplanung",
  "hilfe",
];

// Nur seeden, wenn noch gar keine Rechte vergeben sind (Erstinitialisierung).
const [cnt] = await conn.query("SELECT COUNT(*) AS n FROM role_permissions");
if (Number(cnt[0].n) === 0) {
  const [roles] = await conn.query(
    "SELECT role_key FROM roles WHERE role_key <> 'administrator'"
  );
  for (const r of roles) {
    for (const mod of DEFAULT_MODULES) {
      await conn.query(
        "INSERT IGNORE INTO role_permissions (role_key, module_key) VALUES (?, ?)",
        [r.role_key, mod]
      );
    }
  }
  console.log(`Standardrechte gesetzt für ${roles.length} Gruppen.`);
} else {
  console.log("Rechte bereits vorhanden – kein Seeding.");
}

const [n] = await conn.query("SELECT COUNT(*) AS n FROM role_permissions");
console.log(`OK: role_permissions bereit. Einträge: ${n[0].n}`);
await conn.end();
