// Adds multi-assignee support: a task_assignees join table, migrates existing
// single assignees, and makes tasks.assigned_to nullable (legacy). Idempotent.
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
  CREATE TABLE IF NOT EXISTS task_assignees (
    task_id INT NOT NULL,
    user_id INT NOT NULL,
    PRIMARY KEY (task_id, user_id),
    INDEX idx_ta_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);

// Migrate existing single assignees into the join table.
await conn.query(`
  INSERT IGNORE INTO task_assignees (task_id, user_id)
  SELECT id, assigned_to FROM tasks WHERE assigned_to IS NOT NULL
`);

// assigned_to is no longer required (join table is the source of truth).
try {
  await conn.query("ALTER TABLE tasks MODIFY assigned_to INT NULL");
} catch (err) {
  console.log("Hinweis: assigned_to bereits nullable oder Änderung übersprungen:", err.message);
}

const [rows] = await conn.query("SELECT COUNT(*) AS n FROM task_assignees");
console.log(`OK: task_assignees bereit. Zuweisungen: ${rows[0].n}`);
await conn.end();
