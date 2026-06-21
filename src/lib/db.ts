import mysql from "mysql2/promise";

declare global {
  // Reuse the pool across hot reloads / server invocations.
  var __mysqlPool: mysql.Pool | undefined;
}

function createPool(): mysql.Pool {
  const { MYSQL_HOST, MYSQL_PORT, MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD } = process.env;
  if (!MYSQL_HOST || !MYSQL_DATABASE || !MYSQL_USER) {
    throw new Error("MySQL ist nicht konfiguriert (MYSQL_HOST/MYSQL_DATABASE/MYSQL_USER fehlen).");
  }
  return mysql.createPool({
    host: MYSQL_HOST,
    port: MYSQL_PORT ? parseInt(MYSQL_PORT, 10) : 3306,
    database: MYSQL_DATABASE,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD ?? "",
    waitForConnections: true,
    connectionLimit: 5,
    charset: "utf8mb4",
    // DATE/DATETIME als String liefern (z.B. "2026-06-20"), nicht als JS-Date,
    // damit Datumsformatierung ohne Zeitzonen-Verschiebung funktioniert.
    dateStrings: true,
  });
}

/** Shared MySQL connection pool. */
export function getPool(): mysql.Pool {
  if (!global.__mysqlPool) {
    global.__mysqlPool = createPool();
  }
  return global.__mysqlPool;
}
