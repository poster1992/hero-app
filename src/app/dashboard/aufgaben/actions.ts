"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername, getUsersForNotification, type AppUser } from "@/lib/users";
import { sendMail } from "@/lib/mailer";
import { sendPushToUsers } from "@/lib/push";
import { getGoogleReviewUrl } from "@/lib/settings";
import {
  createTaskNotification,
  acknowledgeNotification,
  acknowledgeAllNotifications,
} from "@/lib/task-notifications";
import {
  createTask,
  setTaskStatus,
  forwardTask,
  addTaskNote,
  getTaskById,
  listTasksForPerson,
  taskStatusLabel,
  TASK_STATUSES,
  type Task,
  type TaskStatus,
} from "@/lib/tasks";

const PATH = "/dashboard/aufgaben";

export interface CreateTaskState {
  error?: string;
  success?: string;
}

async function currentUser(): Promise<AppUser | null> {
  const session = await getSession();
  if (!session) return null;
  return getUserByUsername(session.username);
}

function formatDueDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}

/** Sends a task notification email to the given user ids (best-effort). */
async function notifyAssignees(
  userIds: number[],
  opts: {
    subject: string;
    title: string;
    description: string | null;
    dueDate: string | null;
    projectLabel: string | null;
    fromName: string;
  }
): Promise<void> {
  const recipients = await getUsersForNotification(userIds);
  const appUrl = process.env.APP_URL?.replace(/\/$/, "");
  const link = appUrl ? `\n\nZur Aufgabe: ${appUrl}/dashboard/aufgaben` : "";
  await Promise.all(
    recipients
      .filter((r) => r.email)
      .map((r) => {
        const text =
          `Hallo ${r.name},\n\n` +
          `${opts.subject}:\n\n` +
          `Titel: ${opts.title}\n` +
          (opts.description ? `Beschreibung: ${opts.description}\n` : "") +
          `Fällig: ${formatDueDate(opts.dueDate)}\n` +
          (opts.projectLabel ? `Projekt: ${opts.projectLabel}\n` : "") +
          `Von: ${opts.fromName}\n` +
          link +
          `\n\n— FLOORTEC Dashboard`;
        return sendMail(r.email as string, `${opts.subject}: ${opts.title}`, text);
      })
  );
}

/**
 * Sendet dem ERSTELLER einer Aufgabe eine Rückmeldung (Notiz/Ereignis) per Mail.
 * Eigene Aktionen des Erstellers lösen keine Mail aus.
 */
async function notifyCreator(
  task: Task,
  actorId: number,
  opts: { subject: string; eventLine: string; note?: string | null; fromName: string }
): Promise<void> {
  if (task.createdById === actorId) return;
  const recipients = await getUsersForNotification([task.createdById]);
  const appUrl = process.env.APP_URL?.replace(/\/$/, "");
  const link = appUrl ? `\n\nZur Aufgabe: ${appUrl}/dashboard/aufgaben` : "";
  const projectLabel = task.projectName
    ? `${task.projectRelativeId != null ? `#${task.projectRelativeId} ` : ""}${task.projectName}`
    : null;
  await Promise.all(
    recipients
      .filter((r) => r.email)
      .map((r) => {
        const text =
          `Hallo ${r.name},\n\n` +
          `Rückmeldung zu deiner Aufgabe „${task.title}":\n\n` +
          `${opts.eventLine}\n` +
          (opts.note ? `Notiz: ${opts.note}\n` : "") +
          `Von: ${opts.fromName}\n` +
          (projectLabel ? `Projekt: ${projectLabel}\n` : "") +
          `Fällig: ${formatDueDate(task.dueDate)}\n` +
          link +
          `\n\n— FLOORTEC Dashboard`;
        return sendMail(r.email as string, `${opts.subject}: ${task.title}`, text);
      })
  );

  // Push-Benachrichtigung an den Ersteller.
  await sendPushToUsers([task.createdById], {
    title: opts.subject,
    body: `${task.title} – ${opts.eventLine}${opts.note ? ` ${opts.note}` : ""}`,
    url: "/dashboard/aufgaben",
    tag: `task-${task.id}`,
  });

  // In-App-Meldung (muss bestätigt werden).
  await createTaskNotification({
    userId: task.createdById,
    taskId: task.id,
    kind: "feedback",
    message: `„${task.title}": ${opts.eventLine}${opts.note ? ` – Notiz: ${opts.note}` : ""}`,
    byName: opts.fromName,
  });
}

export async function createTaskAction(
  _prev: CreateTaskState,
  formData: FormData
): Promise<CreateTaskState> {
  const me = await currentUser();
  if (!me) return { error: "Nicht angemeldet." };
  const meId = me.id;

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const assignedTo = formData
    .getAll("assignedTo")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);
  const dueDate = String(formData.get("dueDate") ?? "").trim() || null;
  const projectIdRaw = Number(formData.get("projectId"));
  const projectId = Number.isFinite(projectIdRaw) && projectIdRaw > 0 ? projectIdRaw : null;
  const projectRelativeIdRaw = Number(formData.get("projectRelativeId"));
  const projectRelativeId =
    Number.isFinite(projectRelativeIdRaw) && projectRelativeIdRaw > 0 ? projectRelativeIdRaw : null;
  const projectName = projectId ? String(formData.get("projectName") ?? "").trim() || null : null;

  if (!title) return { error: "Bitte einen Titel angeben." };
  if (assignedTo.length === 0) {
    return { error: "Bitte mindestens einen Mitarbeiter auswählen." };
  }
  if (!dueDate) return { error: "Bitte ein Fälligkeitsdatum angeben." };

  try {
    await createTask({
      title,
      description,
      createdBy: meId,
      assignedTo,
      dueDate,
      projectId,
      projectRelativeId,
      projectName,
    });
  } catch {
    return { error: "Aufgabe konnte nicht angelegt werden." };
  }

  // E-Mail-Benachrichtigung an die zugewiesenen Mitarbeiter (best-effort).
  await notifyAssignees(assignedTo, {
    subject: "Neue Aufgabe",
    title,
    description,
    dueDate,
    projectLabel: projectName
      ? `${projectRelativeId != null ? `#${projectRelativeId} ` : ""}${projectName}`
      : null,
    fromName: me.displayName || me.username,
  });
  // Push an die zugewiesenen Mitarbeiter.
  await sendPushToUsers(assignedTo, {
    title: "Neue Aufgabe",
    body: `${title} – von ${me.displayName || me.username}`,
    url: "/dashboard/aufgaben",
    tag: "task-new",
  });
  // In-App-Meldung (muss bestätigt werden) an die Zugewiesenen (außer Ersteller).
  await Promise.all(
    assignedTo
      .filter((uid) => uid !== meId)
      .map((uid) =>
        createTaskNotification({
          userId: uid,
          taskId: null,
          kind: "assigned",
          message: `Neue Aufgabe: „${title}"`,
          byName: me.displayName || me.username,
        })
      )
  );

  revalidatePath(PATH);
  return { success: "Aufgabe wurde gesendet." };
}

export async function setStatusAction(formData: FormData): Promise<void> {
  const me = await currentUser();
  if (!me) return;
  const meId = me.id;

  const id = Number(formData.get("id"));
  const status = String(formData.get("status")) as TaskStatus;
  const note = String(formData.get("note") ?? "").trim();
  if (!Number.isFinite(id)) return;
  if (!TASK_STATUSES.some((s) => s.key === status)) return;
  // Bemerkung ist beim Statuswechsel Pflicht.
  if (!note) return;

  // Nur Ersteller oder eine zugewiesene Person dürfen den Status ändern.
  const task = await getTaskById(id);
  if (!task) return;
  const mayChange = task.createdById === meId || task.assignees.some((a) => a.id === meId);
  if (!mayChange) return;

  await setTaskStatus(id, status, meId, note.slice(0, 2000));

  // Rückmeldung an den Ersteller (sofern nicht er selbst geändert hat).
  await notifyCreator(task, meId, {
    subject: "Aufgabe aktualisiert",
    eventLine: `Status geändert auf „${taskStatusLabel(status)}".`,
    note,
    fromName: me.displayName || me.username,
  });

  revalidatePath(PATH);
}

export async function addNoteAction(formData: FormData): Promise<void> {
  const me = await currentUser();
  if (!me) return;
  const meId = me.id;

  const id = Number(formData.get("id"));
  const note = String(formData.get("note") ?? "").trim();
  if (!Number.isFinite(id) || !note) return;

  // Nur Ersteller oder eine zugewiesene Person dürfen eine Notiz hinzufügen.
  const task = await getTaskById(id);
  if (!task) return;
  const mayNote = task.createdById === meId || task.assignees.some((a) => a.id === meId);
  if (!mayNote) return;

  await addTaskNote(id, meId, note.slice(0, 2000));

  // Rückmeldung an den Ersteller (sofern nicht er selbst die Notiz schrieb).
  await notifyCreator(task, meId, {
    subject: "Neue Notiz zur Aufgabe",
    eventLine: "Es wurde eine Notiz hinzugefügt.",
    note,
    fromName: me.displayName || me.username,
  });

  revalidatePath(PATH);
}

export async function forwardAction(formData: FormData): Promise<void> {
  const me = await currentUser();
  if (!me) return;
  const meId = me.id;

  const id = Number(formData.get("id"));
  const toUserId = Number(formData.get("toUserId"));
  if (!Number.isFinite(id) || !Number.isFinite(toUserId) || toUserId <= 0) return;

  // Nur Ersteller oder eine zugewiesene Person dürfen weiterleiten.
  const task = await getTaskById(id);
  if (!task) return;
  const mayForward = task.createdById === meId || task.assignees.some((a) => a.id === meId);
  if (!mayForward) return;

  await forwardTask(id, meId, toUserId);

  const [toUser] = await getUsersForNotification([toUserId]);
  const toName = toUser?.name ?? `#${toUserId}`;

  // Benachrichtigung an die Person, an die weitergeleitet wurde.
  await notifyAssignees([toUserId], {
    subject: "Aufgabe weitergeleitet",
    title: task.title,
    description: task.description,
    dueDate: task.dueDate,
    projectLabel: task.projectName
      ? `${task.projectRelativeId != null ? `#${task.projectRelativeId} ` : ""}${task.projectName}`
      : null,
    fromName: me.displayName || me.username,
  });
  // Push an die Person, an die weitergeleitet wurde.
  await sendPushToUsers([toUserId], {
    title: "Aufgabe weitergeleitet",
    body: `${task.title} – von ${me.displayName || me.username}`,
    url: "/dashboard/aufgaben",
    tag: `task-${task.id}`,
  });
  // In-App-Meldung an die Person, an die weitergeleitet wurde.
  await createTaskNotification({
    userId: toUserId,
    taskId: task.id,
    kind: "assigned",
    message: `Aufgabe weitergeleitet: „${task.title}"`,
    byName: me.displayName || me.username,
  });

  // Rückmeldung an den Ersteller (sofern nicht er selbst weitergeleitet hat).
  await notifyCreator(task, meId, {
    subject: "Aufgabe weitergeleitet",
    eventLine: `Weitergeleitet an ${toName}.`,
    fromName: me.displayName || me.username,
  });

  revalidatePath(PATH);
}

/** Bestätigt eine Meldung („zur Kenntnis genommen"). */
export async function acknowledgeNotificationAction(formData: FormData): Promise<void> {
  const me = await currentUser();
  if (!me) return;
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  await acknowledgeNotification(id, me.id);
  revalidatePath(PATH);
}

/** Bestätigt alle eigenen Meldungen. */
export async function acknowledgeAllNotificationsAction(): Promise<void> {
  const me = await currentUser();
  if (!me) return;
  await acknowledgeAllNotifications(me.id);
  revalidatePath(PATH);
}

/** Antwort-Button an einer Aufgabe: protokolliert die Antwort, erledigt die Aufgabe, meldet dem Ersteller. */
export async function taskButtonAction(formData: FormData): Promise<void> {
  const me = await currentUser();
  if (!me) return;
  const id = Number(formData.get("id"));
  const label = String(formData.get("label") ?? "").trim();
  if (!Number.isFinite(id) || !label) return;

  const task = await getTaskById(id);
  if (!task) return;
  // Nur vordefinierte Buttons dieser Aufgabe zulassen.
  if (!task.actionButtons.includes(label)) return;
  const may = task.createdById === me.id || task.assignees.some((a) => a.id === me.id);
  if (!may) return;

  await setTaskStatus(id, "erledigt", me.id, `Antwort: ${label}`);
  await notifyCreator(task, me.id, {
    subject: "Aufgabe beantwortet",
    eventLine: `Antwort: „${label}" – Aufgabe erledigt.`,
    fromName: me.displayName || me.username,
  });
  revalidatePath(PATH);
}

export interface SendReviewResult {
  ok: boolean;
  error?: string;
}

/** Ansprechende, mail-client-kompatible HTML-Vorlage für die Zufriedenheits-Mail. */
function buildReviewEmailHtml(anrede: string, url: string): string {
  const RED = "#e8392a";
  const DARK = "#111417";
  const stars = "★★★★★";
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light only"/><title>FLOORTEC</title></head>
<body style="margin:0;padding:0;background:#f2f3f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f3f5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,0.08);font-family:Arial,Helvetica,sans-serif;">
        <!-- Kopf -->
        <tr><td style="background:${DARK};padding:26px 32px;">
          <span style="font-size:26px;font-weight:800;letter-spacing:4px;color:#ffffff;">FLOOR<span style="color:${RED};">TEC</span></span>
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

/** Sendet dem Kunden einen Link zur Google-Bewertungsseite (E-Mail aus dem Kundenstamm). */
export async function sendReviewEmailAction(formData: FormData): Promise<SendReviewResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Nicht angemeldet." };
  const user = await getUserByUsername(session.username);
  if (!user) return { ok: false, error: "Kein Benutzer." };

  const taskId = Number(formData.get("taskId"));
  const email = String(formData.get("email") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Ungültige E-Mail-Adresse." };

  const url = await getGoogleReviewUrl();
  if (!url) {
    return { ok: false, error: "Google-Bewertungslink ist nicht konfiguriert (unter Konfiguration → Einstellungen eintragen)." };
  }

  const anrede = name ? `Hallo ${name},` : "Guten Tag,";
  const subject = "Ihre Meinung ist uns wichtig – FLOORTEC";
  const text =
    `${anrede}\n\nvielen Dank, dass wir für Sie tätig sein durften. Wir hoffen, Sie sind mit unserer Arbeit rundum zufrieden.\n\n` +
    `Über eine kurze Google-Bewertung würden wir uns sehr freuen – das dauert nur eine Minute:\n${url}\n\n` +
    `Herzlichen Dank und beste Grüße\nIhr FLOORTEC-Team`;
  const html = buildReviewEmailHtml(anrede, url);

  try {
    const ok = await sendMail(email, subject, text, html);
    if (!ok) return { ok: false, error: "E-Mail konnte nicht gesendet werden." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sendefehler." };
  }

  try {
    if (Number.isFinite(taskId) && taskId > 0) {
      await addTaskNote(taskId, user.id, `Google-Bewertungslink gesendet an ${email}`);
    }
  } catch {
    /* Protokoll ist best-effort */
  }
  revalidatePath(PATH);
  return { ok: true };
}

/** Admin: lädt alle Aufgaben einer bestimmten Person (zugewiesen oder erstellt). */
export async function loadPersonTasksAction(userId: number): Promise<Task[]> {
  const me = await currentUser();
  if (!me) return [];
  const session = await getSession();
  if (session?.role !== "administrator") return [];
  if (!Number.isFinite(userId) || userId <= 0) return [];
  try {
    return await listTasksForPerson(userId);
  } catch {
    return [];
  }
}
