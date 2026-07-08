import "server-only";
import { getGoogleReviewUrl } from "./settings";
import { sendMail } from "./mailer";

/** Ansprechende, mail-client-kompatible HTML-Vorlage für die Google-Bewertungs-Mail. */
export function buildReviewEmailHtml(anrede: string, url: string, logoUrl: string): string {
  const RED = "#e8392a";
  const stars = "★★★★★";
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light only"/><title>FLOORTEC</title></head>
<body style="margin:0;padding:0;background:#f2f3f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f3f5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,0.08);font-family:Arial,Helvetica,sans-serif;">
        <!-- Kopf mit Logo -->
        <tr><td align="center" style="background:#ffffff;padding:26px 32px 18px;">
          <img src="${logoUrl}" alt="FLOORTEC" width="210" style="display:block;border:0;outline:none;text-decoration:none;height:auto;width:210px;max-width:66%;" />
        </td></tr>
        <!-- Akzentlinie -->
        <tr><td style="height:4px;background:${RED};line-height:4px;font-size:0;">&nbsp;</td></tr>
        <!-- Inhalt -->
        <tr><td style="padding:34px 32px 8px;">
          <p style="margin:0 0 6px;font-size:15px;color:#111417;">${anrede}</p>
          <h1 style="margin:6px 0 14px;font-size:22px;line-height:1.3;color:#111417;">Wie zufrieden waren Sie mit uns?</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3f4650;">
            vielen Dank, dass wir für Sie tätig sein durften. Wir hoffen, Sie sind mit unserer Arbeit
            rundum zufrieden. Über eine kurze <strong>Google-Bewertung</strong> würden wir uns sehr freuen –
            das dauert nur eine Minute und hilft uns enorm.
          </p>
          <div style="font-size:26px;letter-spacing:4px;color:#f5b301;margin:6px 0 22px;">${stars}</div>
          <!-- CTA Button (bulletproof) -->
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr>
            <td align="center" bgcolor="${RED}" style="border-radius:8px;">
              <a href="${url}" target="_blank" style="display:inline-block;padding:14px 30px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">
                Jetzt bei Google bewerten &rsaquo;
              </a>
            </td>
          </tr></table>
          <p style="margin:0 0 24px;font-size:12px;color:#8a929c;">
            Falls der Button nicht funktioniert, nutzen Sie diesen Link:<br/>
            <a href="${url}" target="_blank" style="color:${RED};word-break:break-all;">${url}</a>
          </p>
          <p style="margin:0 0 4px;font-size:15px;color:#111417;">Herzlichen Dank und beste Grüße</p>
          <p style="margin:0;font-size:15px;font-weight:700;color:#111417;">Ihr FLOORTEC-Team</p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:22px 32px;border-top:1px solid #eceef1;background:#fafbfc;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#8a929c;">
            FLOORTEC S.à r.l. · 11, Um Lënster Bierg · L-6125 Junglinster<br/>
            Diese E-Mail wurde im Rahmen Ihres abgeschlossenen Auftrags versendet.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export interface SendReviewMailResult {
  ok: boolean;
  error?: string;
}

/**
 * Baut und versendet die Google-Bewertungs-Mail an eine Adresse.
 * Prüft NICHT auf Doppelversand – das übernimmt der Aufrufer.
 */
export async function sendReviewMail(email: string, name: string | null): Promise<SendReviewMailResult> {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: "Ungültige E-Mail-Adresse." };
  }
  const url = await getGoogleReviewUrl();
  if (!url) {
    return {
      ok: false,
      error: "Google-Bewertungslink ist nicht konfiguriert (unter Konfiguration → Einstellungen eintragen).",
    };
  }

  const anrede = name ? `Hallo ${name},` : "Guten Tag,";
  const subject = "Ihre Meinung ist uns wichtig – FLOORTEC";
  const text =
    `${anrede}\n\nvielen Dank, dass wir für Sie tätig sein durften. Wir hoffen, Sie sind mit unserer Arbeit rundum zufrieden.\n\n` +
    `Über eine kurze Google-Bewertung würden wir uns sehr freuen – das dauert nur eine Minute:\n${url}\n\n` +
    `Herzlichen Dank und beste Grüße\nIhr FLOORTEC-Team`;
  const base = process.env.APP_URL?.replace(/\/$/, "") || "https://floortec.pascaloster.de";
  const html = buildReviewEmailHtml(anrede, url, `${base}/logo.png`);

  try {
    const ok = await sendMail(email, subject, text, html);
    if (!ok) return { ok: false, error: "E-Mail konnte nicht gesendet werden (SMTP prüfen)." };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sendefehler." };
  }
}
