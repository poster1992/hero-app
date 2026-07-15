import "server-only";

const RED = "#e8392a";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface BaustelleFertigMail {
  customerName: string | null;
  projectLabel: string; // z.B. "#199 MFH Trier"
  logText: string; // der Logbuchtext
  author: string | null;
  dateLabel: string; // z.B. "15.07.2026"
  projectUrl: string;
  logoUrl: string;
}

/** Schön gestaltete HTML-Mail „Baustelle fertiggestellt" im FLOORTEC-Stil. */
export function buildBaustelleFertigEmailHtml(m: BaustelleFertigMail): string {
  const row = (label: string, value: string) =>
    `<tr>
       <td style="padding:6px 0;font-size:13px;color:#8a929c;white-space:nowrap;vertical-align:top;width:90px;">${label}</td>
       <td style="padding:6px 0;font-size:14px;color:#111417;">${value}</td>
     </tr>`;
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light only"/><title>Baustelle fertiggestellt</title></head>
<body style="margin:0;padding:0;background:#f2f3f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f3f5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,0.08);font-family:Arial,Helvetica,sans-serif;">
        <tr><td align="center" style="background:#ffffff;padding:24px 32px 14px;">
          <img src="${m.logoUrl}" alt="FLOORTEC" width="190" style="display:block;border:0;height:auto;width:190px;max-width:60%;" />
        </td></tr>
        <tr><td style="height:4px;background:${RED};line-height:4px;font-size:0;">&nbsp;</td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <h1 style="margin:0 0 6px;font-size:21px;color:#111417;">✅ Baustelle fertiggestellt</h1>
          <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#3f4650;">
            Im Logbuch wurde eine Baustelle als fertig gemeldet. Bitte die <strong>Abschlussrechnung</strong> anstoßen.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 18px;">
            ${row("Kunde", esc(m.customerName || "–"))}
            ${row("Projekt", esc(m.projectLabel))}
            ${row("Gemeldet", esc(m.dateLabel) + (m.author ? ` · ${esc(m.author)}` : ""))}
          </table>
          <div style="margin:0 0 22px;padding:14px 16px;background:#fafbfc;border:1px solid #eceef1;border-left:3px solid ${RED};border-radius:8px;font-size:14px;line-height:1.6;color:#3f4650;white-space:pre-wrap;">${esc(m.logText)}</div>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 8px;"><tr>
            <td align="center" bgcolor="${RED}" style="border-radius:8px;">
              <a href="${m.projectUrl}" target="_blank" style="display:inline-block;padding:12px 26px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">Zum Projekt &rsaquo;</a>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #eceef1;background:#fafbfc;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#8a929c;">
            Automatische Benachrichtigung · FLOORTEC Dashboard
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** Plaintext-Variante der „Baustelle fertig"-Mail. */
export function buildBaustelleFertigEmailText(m: BaustelleFertigMail): string {
  return [
    "Baustelle fertiggestellt",
    "",
    `Kunde:   ${m.customerName || "–"}`,
    `Projekt: ${m.projectLabel}`,
    `Gemeldet: ${m.dateLabel}${m.author ? ` · ${m.author}` : ""}`,
    "",
    m.logText,
    "",
    `Zum Projekt: ${m.projectUrl}`,
    "",
    "Bitte die Abschlussrechnung anstoßen. — FLOORTEC Dashboard",
  ].join("\n");
}
