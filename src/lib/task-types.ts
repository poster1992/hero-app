// Client-safe task types & helpers (NO database import — usable in client components).

export type TaskStatus = "offen" | "in_arbeit" | "erledigt";

export const TASK_STATUSES: { key: TaskStatus; label: string }[] = [
  { key: "offen", label: "Offen" },
  { key: "in_arbeit", label: "In Arbeit" },
  { key: "erledigt", label: "Erledigt" },
];

export function taskStatusLabel(status: string): string {
  return TASK_STATUSES.find((s) => s.key === status)?.label ?? status;
}

/** True if a task is past its due date and not yet done. */
export function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate || status === "erledigt") return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
  return dueDate < today;
}

export interface TaskAssignee {
  id: number;
  name: string;
}

export interface TaskHistoryEntry {
  id: number;
  action: string;
  detail: string | null;
  byName: string | null;
  at: string | null;
}

export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  dueDate: string | null;
  createdById: number;
  createdByName: string;
  assignees: TaskAssignee[];
  history: TaskHistoryEntry[];
  projectId: number | null;
  projectRelativeId: number | null;
  projectName: string | null;
  createdAt: string | null;
  /** Vordefinierte Antwort-Buttons (z.B. aus einer Workflow-Regel). */
  actionButtons: string[];
}
