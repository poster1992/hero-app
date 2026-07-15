import nodemailer from "nodemailer";
import { getSmtpConfig } from "./settings";

/** Baut aus der aktuellen Konfiguration einen Transporter (oder null, wenn unvollständig). */
async function buildTransport(): Promise<{ t: nodemailer.Transporter; from: string } | null> {
  const c = await getSmtpConfig();
  if (!c.host || !c.user || !c.pass) return null;
  const secure = c.port === 465; // 465 = SSL, 587 = STARTTLS (z.B. Microsoft 365)
  const t = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure,
    requireTLS: !secure,
    auth: { user: c.user, pass: c.pass },
    tls: { minVersion: "TLSv1.2" },
  });
  return { t, from: c.from || c.user };
}

export interface MailResult {
  ok: boolean;
  error?: string;
}

/** Sendet eine E-Mail und liefert eine Fehlermeldung zurück (für Setup/Tests). */
export async function sendMailResult(to: string, subject: string, text: string, html?: string): Promise<MailResult> {
  const b = await buildTransport();
  if (!b) return { ok: false, error: "SMTP ist nicht konfiguriert (Host, Benutzer oder Passwort fehlt)." };
  try {
    await b.t.sendMail({ from: b.from, to, subject, text, html });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sendefehler." };
  }
}

/**
 * Sendet eine E-Mail. Returns true on success, false if SMTP is not configured or
 * sending failed (never throws – notifications must not break the main action).
 */
export async function sendMail(to: string, subject: string, text: string, html?: string): Promise<boolean> {
  const r = await sendMailResult(to, subject, text, html);
  if (!r.ok && r.error) console.error("[mail] Versand fehlgeschlagen:", r.error);
  return r.ok;
}

/** Ein Inline-Anhang (z.B. eingebettetes Foto-Thumbnail per cid). */
export interface MailAttachment {
  filename: string;
  content: Buffer;
  /** Content-ID für `<img src="cid:...">` (Inline-Bild). */
  cid?: string;
  contentType?: string;
}

/**
 * Wie sendMail, aber mit Anhängen (z.B. Inline-Fotos per cid). Wirft nie – gibt bei
 * Erfolg true zurück, sonst false. Für den Tagesbericht.
 */
export async function sendMailWithAttachments(
  to: string,
  subject: string,
  text: string,
  html: string,
  attachments: MailAttachment[]
): Promise<boolean> {
  const b = await buildTransport();
  if (!b) {
    console.error("[mail] Versand fehlgeschlagen: SMTP nicht konfiguriert.");
    return false;
  }
  try {
    await b.t.sendMail({ from: b.from, to, subject, text, html, attachments });
    return true;
  } catch (e) {
    console.error("[mail] Versand fehlgeschlagen:", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Prüft die SMTP-Verbindung/Anmeldung (für den Test-Button). */
export async function verifySmtp(): Promise<MailResult> {
  const b = await buildTransport();
  if (!b) return { ok: false, error: "SMTP ist nicht konfiguriert (Host, Benutzer oder Passwort fehlt)." };
  try {
    await b.t.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Verbindungsfehler." };
  }
}
