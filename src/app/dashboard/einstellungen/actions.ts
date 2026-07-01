"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import {
  setSetting,
  GOOGLE_REVIEW_URL_KEY,
  SMTP_HOST_KEY,
  SMTP_PORT_KEY,
  SMTP_USER_KEY,
  SMTP_PASS_KEY,
  SMTP_FROM_KEY,
} from "@/lib/settings";
import { getUserByUsername } from "@/lib/users";
import { sendMailResult, verifySmtp } from "@/lib/mailer";

const PATH = "/dashboard/einstellungen";

async function isAdmin(): Promise<boolean> {
  const s = await getSession();
  return !!s && s.role === "administrator";
}

export interface SettingsState {
  error?: string;
  success?: string;
}

export async function saveGoogleReviewUrlAction(
  _prev: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const session = await getSession();
  if (!session || session.role !== "administrator") return { error: "Kein Zugriff." };

  const raw = String(formData.get("googleReviewUrl") ?? "").trim();
  if (raw && !/^https?:\/\/\S+$/i.test(raw)) {
    return { error: "Bitte eine gültige URL (beginnend mit http:// oder https://) eingeben." };
  }
  try {
    await setSetting(GOOGLE_REVIEW_URL_KEY, raw || null);
  } catch {
    return { error: "Speichern fehlgeschlagen." };
  }
  revalidatePath(PATH);
  return { success: raw ? "Bewertungslink gespeichert." : "Bewertungslink entfernt." };
}

/** Speichert die SMTP-Zugangsdaten (Passwort nur, wenn ein neues eingegeben wurde). */
export async function saveSmtpAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  if (!(await isAdmin())) return { error: "Kein Zugriff." };
  const host = String(formData.get("smtpHost") ?? "").trim();
  const port = String(formData.get("smtpPort") ?? "").trim() || "587";
  const user = String(formData.get("smtpUser") ?? "").trim();
  const from = String(formData.get("smtpFrom") ?? "").trim();
  const pass = String(formData.get("smtpPass") ?? "");
  if (!/^\d+$/.test(port)) return { error: "Port muss eine Zahl sein (z. B. 587)." };
  try {
    await Promise.all([
      setSetting(SMTP_HOST_KEY, host || null),
      setSetting(SMTP_PORT_KEY, port),
      setSetting(SMTP_USER_KEY, user || null),
      setSetting(SMTP_FROM_KEY, from || null),
    ]);
    // Passwort nur überschreiben, wenn ein neues eingegeben wurde (sonst bleibt es erhalten).
    if (pass.length > 0) await setSetting(SMTP_PASS_KEY, pass);
  } catch {
    return { error: "Speichern fehlgeschlagen." };
  }
  revalidatePath(PATH);
  return { success: "SMTP-Einstellungen gespeichert." };
}

export interface TestMailResult {
  ok: boolean;
  message: string;
}

/** Prüft die SMTP-Verbindung und sendet eine Testmail. */
export async function sendTestMailAction(to: string): Promise<TestMailResult> {
  const session = await getSession();
  if (!session || session.role !== "administrator") return { ok: false, message: "Kein Zugriff." };
  const target = to.trim() || (await getUserByUsername(session.username))?.email || "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target)) return { ok: false, message: "Bitte eine gültige Empfänger-Adresse angeben." };

  const v = await verifySmtp();
  if (!v.ok) return { ok: false, message: `Verbindung/Anmeldung fehlgeschlagen: ${v.error}` };

  const r = await sendMailResult(
    target,
    "SMTP-Test – FLOORTEC Dashboard",
    "Dies ist eine Testmail aus dem FLOORTEC Dashboard. Wenn du sie erhältst, ist der E-Mail-Versand korrekt eingerichtet.",
    "<p>Dies ist eine <strong>Testmail</strong> aus dem FLOORTEC Dashboard.</p><p>Wenn du sie erhältst, ist der E-Mail-Versand korrekt eingerichtet. ✅</p>"
  );
  return r.ok
    ? { ok: true, message: `Testmail an ${target} gesendet.` }
    : { ok: false, message: `Versand fehlgeschlagen: ${r.error}` };
}
