import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

/** Bekannte Einstellungs-Schlüssel. */
export const GOOGLE_REVIEW_URL_KEY = "google_review_url";

export async function getSetting(key: string): Promise<string | null> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1",
    [key]
  );
  const r = rows[0] as { setting_value: string | null } | undefined;
  return r?.setting_value ?? null;
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  await getPool().query(
    `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, value]
  );
}

// --- SMTP (E-Mail-Versand), pflegbar über die Konfiguration ---
export const SMTP_HOST_KEY = "smtp_host";
export const SMTP_PORT_KEY = "smtp_port";
export const SMTP_USER_KEY = "smtp_user";
export const SMTP_PASS_KEY = "smtp_pass";
export const SMTP_FROM_KEY = "smtp_from";

export interface SmtpConfig {
  host: string | null;
  port: number;
  user: string | null;
  pass: string | null;
  from: string | null;
}

/** SMTP-Konfiguration: erst aus der DB (Konfiguration), sonst aus der Umgebung. */
export async function getSmtpConfig(): Promise<SmtpConfig> {
  const pick = (v: string | null, env: string | undefined) => (v && v.trim() ? v.trim() : env?.trim() || null);
  let host: string | null = null, portRaw: string | null = null, user: string | null = null, pass: string | null = null, from: string | null = null;
  try {
    [host, portRaw, user, pass, from] = await Promise.all([
      getSetting(SMTP_HOST_KEY),
      getSetting(SMTP_PORT_KEY),
      getSetting(SMTP_USER_KEY),
      getSetting(SMTP_PASS_KEY),
      getSetting(SMTP_FROM_KEY),
    ]);
  } catch {
    /* Fallback auf env */
  }
  const portStr = (portRaw && portRaw.trim()) || process.env.SMTP_PORT || "587";
  return {
    host: pick(host, process.env.SMTP_HOST),
    port: Number(portStr) || 587,
    user: pick(user, process.env.SMTP_USER),
    // Passwort: DB-Wert (auch wenn es Sonderzeichen enthält) nicht trimmen.
    pass: pass && pass.length ? pass : process.env.SMTP_PASS || null,
    from: pick(from, process.env.SMTP_FROM),
  };
}

/** Google-Bewertungslink: erst aus der DB, sonst aus der Umgebungsvariable. */
export async function getGoogleReviewUrl(): Promise<string | null> {
  try {
    const v = await getSetting(GOOGLE_REVIEW_URL_KEY);
    if (v && v.trim()) return v.trim();
  } catch {
    /* Fallback auf env */
  }
  return process.env.GOOGLE_REVIEW_URL?.trim() || null;
}
