import "server-only";
import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";
import { userEmail } from "./users";
import { sendMail } from "./mailer";
import { localDateIso, localHour } from "./daily-report";
import {
  getSetting,
  setSetting,
  TASK_DIGEST_ENABLED_KEY,
  TASK_DIGEST_HOUR_KEY,
  TASK_DIGEST_LAST_SENT_KEY,
  TASK_DIGEST_LAST_ATTEMPT_KEY,
} from "./settings";

interface DigestTask {
  id: number;
  title: string;
  status: string;
  dueDate: string | null;
  projectRelativeId: number | null;
  projectName: string | null;
  overdue: boolean;
}

interface UserDigest {
  userId: number;
  name: string;
  email: string;
  tasks: DigestTask[];
}

const RED = "#e8392a";
const dueFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

function appBase(): string {
  return process.env.APP_URL?.replace(/\/$/, "") || "https://floortec.pascaloster.de";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDue(iso: string | null): string {
  if (!iso) return "ohne Datum";
  const [y, m, d] = iso.split("-").map(Number);
  return dueFmt.format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Offene Aufgaben (Status ≠ erledigt) je aktivem Mitarbeiter mit E-Mail-Adresse.
 * Überfällige zuerst, dann nach Fälligkeit.
 */
export async function listOpenTasksByAssignee(): Promise<UserDigest[]> {
  const today = localDateIso();
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT u.id AS user_id,
            COALESCE(NULLIF(u.display_name, ''), u.username) AS name,
            u.email AS email, u.username AS username,
            t.id AS task_id, t.title AS title, t.status AS status, t.due_date AS due_date,
            t.project_relative_id AS project_relative_id, t.project_name AS project_name
       FROM task_assignees ta
       JOIN users u ON u.id = ta.user_id
       JOIN tasks t ON t.id = ta.task_id
      WHERE t.status <> 'erledigt' AND u.is_active = 1
      ORDER BY u.id, (t.due_date IS NULL) ASC, t.due_date ASC, t.id ASC`
  );

  const byUser = new Map<number, UserDigest>();
  for (const r of rows) {
    const email = userEmail({ email: r.email as string | null, username: r.username as string });
    if (!email) continue; // ohne E-Mail keine Digest-Mail
    const uid = r.user_id as number;
    let entry = byUser.get(uid);
    if (!entry) {
      entry = { userId: uid, name: r.name as string, email, tasks: [] };
      byUser.set(uid, entry);
    }
    const dueDate = r.due_date ? String(r.due_date).slice(0, 10) : null;
    entry.tasks.push({
      id: r.task_id as number,
      title: r.title as string,
      status: r.status as string,
      dueDate,
      projectRelativeId: r.project_relative_id as number | null,
      projectName: r.project_name as string | null,
      overdue: dueDate != null && dueDate < today,
    });
  }
  return [...byUser.values()];
}

function buildHtml(d: UserDigest): string {
  const url = `${appBase()}/dashboard/aufgaben`;
  const overdueCount = d.tasks.filter((t) => t.overdue).length;
  const rows = d.tasks
    .map((t) => {
      const proj = t.projectName
        ? `${t.projectRelativeId != null ? `#${t.projectRelativeId} ` : ""}${esc(t.projectName)}`
        : "";
      const dueColor = t.overdue ? RED : "#3f4650";
      const dueLabel = `${t.overdue ? "überfällig · " : "fällig "}${fmtDue(t.dueDate)}`;
      return `<tr>
        <td style="padding:8px 10px;border-top:1px solid #eceef1;font-size:14px;color:#111417;">
          <strong>${esc(t.title)}</strong>${proj ? `<span style="color:#8a929c;"> · ${proj}</span>` : ""}
        </td>
        <td style="padding:8px 10px;border-top:1px solid #eceef1;font-size:13px;color:${dueColor};white-space:nowrap;text-align:right;">
          ${dueLabel}
        </td>
      </tr>`;
    })
    .join("");

  return `<!doctype html><html lang="de"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="color-scheme" content="light only"/>
<title>Deine offenen Aufgaben</title></head>
<body style="margin:0;padding:0;background:#f2f3f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f3f5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.08);font-family:Arial,Helvetica,sans-serif;">
        <tr><td style="height:4px;background:${RED};line-height:4px;font-size:0;">&nbsp;</td></tr>
        <tr><td style="padding:24px 28px 6px;">
          <h1 style="margin:0 0 4px;font-size:20px;color:#111417;">Hallo ${esc(d.name)},</h1>
          <p style="margin:0 0 16px;font-size:14px;color:#3f4650;">
            du hast noch <strong>${d.tasks.length}</strong> offene ${d.tasks.length === 1 ? "Aufgabe" : "Aufgaben"}${
              overdueCount > 0 ? `, davon <strong style="color:${RED};">${overdueCount} überfällig</strong>` : ""
            }.
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #eceef1;border-radius:8px;overflow:hidden;">
            ${rows}
          </table>
          <p style="margin:18px 0 24px;">
            <a href="${url}" target="_blank" style="display:inline-block;background:${RED};color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px;">Aufgaben öffnen</a>
          </p>
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #eceef1;background:#fafbfc;">
          <p style="margin:0;font-size:12px;color:#8a929c;">Automatische Erinnerung · FLOORTEC Dashboard</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function buildText(d: UserDigest): string {
  const lines = [`Hallo ${d.name},`, "", `du hast noch ${d.tasks.length} offene Aufgabe(n):`, ""];
  for (const t of d.tasks) {
    const proj = t.projectName
      ? ` · ${t.projectRelativeId != null ? `#${t.projectRelativeId} ` : ""}${t.projectName}`
      : "";
    const due = `${t.overdue ? "ÜBERFÄLLIG " : "fällig "}${fmtDue(t.dueDate)}`;
    lines.push(`- ${t.title}${proj} (${due})`);
  }
  lines.push("", `Aufgaben öffnen: ${appBase()}/dashboard/aufgaben`, "", "— FLOORTEC Dashboard");
  return lines.join("\n");
}

/**
 * Versendet je Mitarbeiter eine Mail mit seinen offenen Aufgaben. Wirft nie.
 * `only` (User-IDs) begrenzt die Empfänger (z. B. für einen Testversand).
 */
export async function sendOpenTaskDigests(
  opts: { only?: number[] } = {}
): Promise<{ sent: boolean; recipients: number; reason?: string }> {
  try {
    let digests = await listOpenTasksByAssignee();
    if (opts.only && opts.only.length > 0) {
      const set = new Set(opts.only);
      digests = digests.filter((d) => set.has(d.userId));
    }
    digests = digests.filter((d) => d.tasks.length > 0);
    if (digests.length === 0) return { sent: true, recipients: 0, reason: "keine offenen Aufgaben" };

    let ok = 0;
    for (const d of digests) {
      const subject = `Deine offenen Aufgaben (${d.tasks.length})`;
      const sent = await sendMail(d.email, subject, buildText(d), buildHtml(d));
      if (sent) ok++;
    }
    return ok > 0
      ? { sent: true, recipients: ok }
      : { sent: false, recipients: 0, reason: "Versand fehlgeschlagen" };
  } catch (e) {
    console.warn("[task-digest] Fehler:", e instanceof Error ? e.message : e);
    return { sent: false, recipients: 0, reason: "Fehler" };
  }
}

interface TaskDigestConfig {
  enabled: boolean;
  hour: number;
}

export async function getTaskDigestConfig(): Promise<TaskDigestConfig> {
  const [enabled, hour] = await Promise.all([
    getSetting(TASK_DIGEST_ENABLED_KEY),
    getSetting(TASK_DIGEST_HOUR_KEY),
  ]);
  const h = hour ? Number(hour) : NaN;
  return {
    enabled: enabled !== "0", // Default: an
    hour: Number.isFinite(h) && h >= 0 && h <= 23 ? h : 18,
  };
}

/**
 * Prüft die Fälligkeit und versendet die „offene Aufgaben"-Mails höchstens einmal
 * pro Kalendertag (lokale Zeit). Wird vom Timer (instrumentation.ts) alle 10 Min aufgerufen.
 */
export async function maybeRunOpenTaskDigests(): Promise<void> {
  const cfg = await getTaskDigestConfig();
  if (!cfg.enabled) return;

  const today = localDateIso();
  if (localHour() < cfg.hour) return; // noch nicht fällig

  const lastSent = await getSetting(TASK_DIGEST_LAST_SENT_KEY);
  if (lastSent === today) return; // heute schon versendet

  // Drossel gegen Dauerschleife bei SMTP-Ausfall: höchstens alle 30 Min ein Versuch.
  const lastAttempt = await getSetting(TASK_DIGEST_LAST_ATTEMPT_KEY);
  const now = Date.now();
  if (lastAttempt) {
    const prev = Number(lastAttempt);
    if (Number.isFinite(prev) && now - prev < 30 * 60 * 1000) return;
  }
  await setSetting(TASK_DIGEST_LAST_ATTEMPT_KEY, String(now));

  const res = await sendOpenTaskDigests();
  if (res.sent) {
    await setSetting(TASK_DIGEST_LAST_SENT_KEY, today);
    console.log(`[task-digest] versendet an ${res.recipients} Mitarbeiter.`);
  }
}
