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

/**
 * Optionen für nutzerausgelöste Mails: Anzeigename des handelnden Benutzers (die
 * Absender-ADRESSE bleibt immer das Versand-Konto – wichtig für Office 365) und
 * Reply-To, damit Antworten beim Benutzer landen.
 */
export interface MailFromOptions {
  fromName?: string;
  replyTo?: string;
}

/** Sendet eine E-Mail und liefert eine Fehlermeldung zurück (für Setup/Tests). */
export async function sendMailResult(
  to: string,
  subject: string,
  text: string,
  html?: string,
  opts?: MailFromOptions
): Promise<MailResult> {
  const b = await buildTransport();
  if (!b) return { ok: false, error: "SMTP ist nicht konfiguriert (Host, Benutzer oder Passwort fehlt)." };
  try {
    await b.t.sendMail({
      // Adresse bleibt das Auth-Konto; nur der Anzeigename wird ggf. gesetzt.
      from: opts?.fromName ? { name: opts.fromName, address: b.from } : b.from,
      to,
      subject,
      text,
      html,
      ...(opts?.replyTo ? { replyTo: opts.replyTo } : {}),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sendefehler." };
  }
}

/**
 * Sendet eine E-Mail. Returns true on success, false if SMTP is not configured or
 * sending failed (never throws – notifications must not break the main action).
 */
export async function sendMail(
  to: string,
  subject: string,
  text: string,
  html?: string,
  opts?: MailFromOptions
): Promise<boolean> {
  const r = await sendMailResult(to, subject, text, html, opts);
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
  attachments: MailAttachment[],
  opts?: MailFromOptions
): Promise<boolean> {
  const b = await buildTransport();
  if (!b) {
    console.error("[mail] Versand fehlgeschlagen: SMTP nicht konfiguriert.");
    return false;
  }
  try {
    await b.t.sendMail({
      from: opts?.fromName ? { name: opts.fromName, address: b.from } : b.from,
      to,
      subject,
      text,
      html,
      attachments,
      ...(opts?.replyTo ? { replyTo: opts.replyTo } : {}),
    });
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
