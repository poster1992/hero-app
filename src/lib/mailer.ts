import nodemailer from "nodemailer";

let cached: nodemailer.Transporter | null | undefined;

function getTransporter(): nodemailer.Transporter | null {
  if (cached !== undefined) return cached;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    cached = null;
    return null;
  }
  const port = SMTP_PORT ? parseInt(SMTP_PORT, 10) : 587;
  const secure = port === 465; // 465 = SSL, 587 = STARTTLS
  cached = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure,
    // Microsoft 365 (smtp.office365.com:587) verlangt STARTTLS + TLS 1.2.
    requireTLS: !secure,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { minVersion: "TLSv1.2" },
  });
  return cached;
}

/** True if SMTP is configured. */
export function mailConfigured(): boolean {
  return getTransporter() !== null;
}

/**
 * Sends an email. Returns true on success, false if SMTP is not configured or
 * sending failed (never throws — notifications must not break the main action).
 */
export async function sendMail(
  to: string,
  subject: string,
  text: string,
  html?: string
): Promise<boolean> {
  const t = getTransporter();
  if (!t) return false;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "";
  try {
    await t.sendMail({ from, to, subject, text, html });
    return true;
  } catch (e) {
    console.error("[mail] Versand fehlgeschlagen:", e instanceof Error ? e.message : e);
    return false;
  }
}
