"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername, getUsersForNotification, type AppUser } from "@/lib/users";
import { sendMail } from "@/lib/mailer";
import {
  createTask,
  setTaskStatus,
  forwardTask,
  getTaskById,
  TASK_STATUSES,
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

  revalidatePath(PATH);
  return { success: "Aufgabe wurde gesendet." };
}

export async function setStatusAction(formData: FormData): Promise<void> {
  const me = await currentUser();
  if (!me) return;
  const meId = me.id;

  const id = Number(formData.get("id"));
  const status = String(formData.get("status")) as TaskStatus;
  if (!Number.isFinite(id)) return;
  if (!TASK_STATUSES.some((s) => s.key === status)) return;

  // Nur Ersteller oder eine zugewiesene Person dürfen den Status ändern.
  const task = await getTaskById(id);
  if (!task) return;
  const mayChange = task.createdById === meId || task.assignees.some((a) => a.id === meId);
  if (!mayChange) return;

  await setTaskStatus(id, status, meId);
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

  revalidatePath(PATH);
}
