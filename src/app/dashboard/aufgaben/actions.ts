"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername, getUsersForNotification, type AppUser } from "@/lib/users";
import { sendMail } from "@/lib/mailer";
import { sendPushToUsers } from "@/lib/push";
import { getGoogleReviewUrl } from "@/lib/settings";
import { buildReviewEmailHtml } from "@/lib/review-mail";
import { wasReviewEmailSent, markReviewEmailSent } from "@/lib/review-emails";
import { addLogbookEntry } from "@/app/dashboard/logbook-actions";
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

  // Nur Ersteller oder eine zugewiesene Person dürfen den Status ändern.
  const task = await getTaskById(id);
  if (!task) return;
  const mayChange = task.createdById === meId || task.assignees.some((a) => a.id === meId);
  if (!mayChange) return;

  await setTaskStatus(id, status, meId, note ? note.slice(0, 2000) : null);

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
  /** true, wenn für dieses Projekt bereits eine Bewertungsmail versendet wurde. */
  alreadySent?: boolean;
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
  // Nur über eine Aufgabe möglich.
  if (!Number.isFinite(taskId) || taskId <= 0) return { ok: false, error: "Nur über eine Aufgabe möglich." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Ungültige E-Mail-Adresse." };

  // Projekt-Schlüssel (aus dem Aufgaben-Marker, sonst aus Projekt-/Kundendaten).
  const task = await getTaskById(taskId);
  const marker = task?.description?.match(/\[BEWERTUNG:([^\]]*)\]/);
  const parts = marker ? marker[1].split("|") : [];
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const projectKey =
    (parts[2] ?? "").trim() ||
    (task?.projectRelativeId != null
      ? `r${task.projectRelativeId}`
      : task?.projectName
        ? `n:${norm(task.projectName)}`
        : `k:${norm(name || email)}`);

  // Nur einmal pro Kunde/Projekt.
  if (await wasReviewEmailSent(projectKey)) {
    return { ok: false, alreadySent: true, error: "Für dieses Projekt wurde bereits eine Bewertungsmail versendet." };
  }

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
  const base = process.env.APP_URL?.replace(/\/$/, "") || "https://floortec.pascaloster.de";
  const html = buildReviewEmailHtml(anrede, url, `${base}/logo.png`);

  try {
    const ok = await sendMail(email, subject, text, html);
    if (!ok) return { ok: false, error: "E-Mail konnte nicht gesendet werden (SMTP prüfen)." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sendefehler." };
  }

  // Versand pro Projekt sperren + protokollieren.
  try {
    await markReviewEmailSent({ projectKey, email, taskId, sentBy: user.id, customerName: name || null });
  } catch {
    /* best-effort */
  }
  try {
    await addTaskNote(taskId, user.id, `Bewertungsmail gesendet an ${email}`);
  } catch {
    /* Protokoll ist best-effort */
  }
  // Logbuch-Eintrag im HERO-Projekt (Projekt-Schlüssel im Marker = p<ProjektID>).
  try {
    const pid = /^p(\d+)$/.exec(projectKey);
    if (pid) {
      await addLogbookEntry(
        Number(pid[1]),
        `Kundenzufriedenheitsumfrage per E-Mail an ${email} versendet (durch ${user.displayName || user.username}).`
      );
    }
  } catch {
    /* Logbuch ist best-effort */
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
