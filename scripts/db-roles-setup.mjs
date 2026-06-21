// Creates the `roles` table, seeds the standard roles, and (optionally) assigns
// the administrator role to a given user.
// Usage: node scripts/db-roles-setup.mjs [adminUsername]
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

const ROLES = [
  { role_key: "administrator", label: "Administrator", sort_order: 1 },
  { role_key: "buero", label: "Büro", sort_order: 2 },
  { role_key: "monteur", label: "Monteure", sort_order: 3 },
];

const e = loadEnv();
const conn = await mysql.createConnection({
  host: e.MYSQL_HOST,
  port: e.MYSQL_PORT ? parseInt(e.MYSQL_PORT, 10) : 3306,
  database: e.MYSQL_DATABASE,
  user: e.MYSQL_USER,
  password: e.MYSQL_PASSWORD ?? "",
});

await conn.query(`
  CREATE TABLE IF NOT EXISTS roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    role_key VARCHAR(50) NOT NULL UNIQUE,
    label VARCHAR(100) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);

for (const r of ROLES) {
  await conn.query(
    `INSERT INTO roles (role_key, label, sort_order) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE label = VALUES(label), sort_order = VALUES(sort_order)`,
    [r.role_key, r.label, r.sort_order]
  );
}

const adminUser = process.argv[2];
if (adminUser) {
  const [res] = await conn.query("UPDATE users SET role = 'administrator' WHERE username = ?", [
    adminUser,
  ]);
  console.log(`Benutzer '${adminUser}' -> administrator (betroffen: ${res.affectedRows})`);
}

const [rows] = await conn.query("SELECT role_key, label FROM roles ORDER BY sort_order");
console.log("Rollen:", rows.map((r) => `${r.role_key} (${r.label})`).join(", "));
await conn.end();
