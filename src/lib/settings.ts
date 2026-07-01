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
