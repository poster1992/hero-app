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
  GOOGLE_PLACES_API_KEY_KEY,
  GOOGLE_PLACE_ID_KEY,
  DAILY_REPORT_ENABLED_KEY,
  DAILY_REPORT_HOUR_KEY,
  DAILY_REPORT_SEND_WHEN_EMPTY_KEY,
  DAILY_REPORT_RECIPIENTS_KEY,
  DAILY_REPORT_OVERRUN_THRESHOLD_KEY,
  DAILY_REPORT_CHECK_HOURS_KEY,
  DAILY_REPORT_CHECK_NOCALC_KEY,
  DAILY_REPORT_CHECK_LOGBOOK_KEY,
  DAILY_REPORT_CHECK_MISSING_KEY,
  DAILY_REPORT_LOGBOOK_KEYWORDS_KEY,
  DAILY_REPORT_INSTRUCTIONS_KEY,
} from "@/lib/settings";
import { getUserByUsername } from "@/lib/users";
import { sendMailResult, verifySmtp } from "@/lib/mailer";
import { getGoogleReviewStats } from "@/lib/google-reviews";
import { addBaustelle, deleteBaustelle } from "@/lib/baustellen-docs";
import { sendDailyReport } from "@/lib/daily-report";

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

/** Speichert Google-Places-API-Key (nur bei Neueingabe) + Place-ID. */
export async function saveGooglePlacesAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  if (!(await isAdmin())) return { error: "Kein Zugriff." };
  const placeId = String(formData.get("placeId") ?? "").trim();
  const apiKey = String(formData.get("apiKey") ?? "");
  try {
    await setSetting(GOOGLE_PLACE_ID_KEY, placeId || null);
    if (apiKey.trim().length > 0) await setSetting(GOOGLE_PLACES_API_KEY_KEY, apiKey.trim());
  } catch {
    return { error: "Speichern fehlgeschlagen." };
  }
  revalidatePath(PATH);
  return { success: "Google-Bewertungen-Einstellungen gespeichert." };
}

export interface CheckReviewsResult {
  ok: boolean;
  message: string;
}

/** Prüft die Google-Places-Konfiguration und zeigt Anzahl/Ø der Rezensionen. */
export async function checkGoogleReviewsAction(): Promise<CheckReviewsResult> {
  if (!(await isAdmin())) return { ok: false, message: "Kein Zugriff." };
  const s = await getGoogleReviewStats();
  if (!s.configured) return { ok: false, message: "Nicht konfiguriert (API-Key oder Place-ID fehlt)." };
  if (s.error) return { ok: false, message: s.error };
  if (s.count == null) return { ok: false, message: "Keine Daten – Place-ID prüfen." };
  return { ok: true, message: `${s.count} Rezensionen · Ø ${s.rating ?? "–"} ★` };
}

/** Fügt einen Baustellen-Doku-Ordner hinzu (löst die Projektnummer über HERO auf). */
export async function addBaustelleAction(
  _prev: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  if (!(await isAdmin())) return { error: "Kein Zugriff." };
  const label = String(formData.get("label") ?? "");
  const projectNr = String(formData.get("projectNr") ?? "");
  const imageCategory = String(formData.get("imageCategory") ?? "");
  const res = await addBaustelle({ label, projectNr, imageCategory });
  if (res.error) return { error: res.error };
  revalidatePath(PATH);
  return { success: `Menüpunkt „${label.trim()}" hinzugefügt.` };
}

/** Entfernt einen Baustellen-Doku-Ordner. */
export async function deleteBaustelleAction(formData: FormData): Promise<void> {
  if (!(await isAdmin())) return;
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) return;
  await deleteBaustelle(id);
  revalidatePath(PATH);
}

/** Speichert die Konfiguration des täglichen Analyse-Berichts (volle Regelsteuerung). */
export async function saveDailyReportConfigAction(
  _prev: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  if (!(await isAdmin())) return { error: "Kein Zugriff." };
  const on = (name: string) => (formData.get(name) === "on" || formData.get(name) === "1" ? "1" : "0");
  const hour = String(formData.get("hour") ?? "18").trim();
  const thr = String(formData.get("overrunThreshold") ?? "100").trim();
  if (!/^\d+$/.test(hour) || Number(hour) > 23) return { error: "Uhrzeit muss 0–23 sein." };
  if (!/^\d+$/.test(thr) || Number(thr) < 100) return { error: "Schwelle muss eine Zahl ≥ 100 (%) sein." };
  const recipients = String(formData.get("recipients") ?? "").trim();
  const keywords = String(formData.get("logbookKeywords") ?? "").trim();
  const instructions = String(formData.get("instructions") ?? "").trim();
  try {
    await Promise.all([
      setSetting(DAILY_REPORT_ENABLED_KEY, on("enabled")),
      setSetting(DAILY_REPORT_HOUR_KEY, hour),
      setSetting(DAILY_REPORT_SEND_WHEN_EMPTY_KEY, on("sendWhenEmpty")),
      setSetting(DAILY_REPORT_RECIPIENTS_KEY, recipients || null),
      setSetting(DAILY_REPORT_OVERRUN_THRESHOLD_KEY, thr),
      setSetting(DAILY_REPORT_CHECK_HOURS_KEY, on("checkHours")),
      setSetting(DAILY_REPORT_CHECK_NOCALC_KEY, on("checkNocalc")),
      setSetting(DAILY_REPORT_CHECK_LOGBOOK_KEY, on("checkLogbook")),
      setSetting(DAILY_REPORT_CHECK_MISSING_KEY, on("checkMissing")),
      setSetting(DAILY_REPORT_LOGBOOK_KEYWORDS_KEY, keywords || null),
      setSetting(DAILY_REPORT_INSTRUCTIONS_KEY, instructions || null),
    ]);
  } catch {
    return { error: "Speichern fehlgeschlagen." };
  }
  revalidatePath(PATH);
  return { success: "Tagesbericht-Einstellungen gespeichert." };
}

export interface TestReportResult {
  ok: boolean;
  message: string;
}

/** Sendet SOFORT einen Testbericht an die eigene Admin-Adresse (umgeht An/Aus). */
export async function sendTestDailyReportAction(): Promise<TestReportResult> {
  const session = await getSession();
  if (!session || session.role !== "administrator") return { ok: false, message: "Kein Zugriff." };
  const email = (await getUserByUsername(session.username))?.email;
  if (!email) return { ok: false, message: "Für deinen Benutzer ist keine E-Mail hinterlegt." };
  const r = await sendDailyReport({ force: true, recipients: [email] });
  return r.sent
    ? { ok: true, message: `Testbericht an ${email} gesendet.` }
    : { ok: false, message: `Nicht gesendet: ${r.reason ?? "unbekannt"}.` };
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
