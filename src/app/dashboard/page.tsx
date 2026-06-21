import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, getEffectiveRole } from "@/lib/session";
import { getAllowedModules } from "@/lib/role-store";
import { getUserByUsername } from "@/lib/users";
import { listTasksAssignedTo, listAllOverdueTasks } from "@/lib/tasks";
import { taskStatusLabel, isOverdue, type TaskStatus } from "@/lib/task-types";
import { getProjectPipeline } from "@/lib/hero-api";
import ProjectPipelines from "@/components/ProjectPipelines";

function formatDate(d: string | null): string {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const cls =
    status === "erledigt"
      ? "bg-emerald-100 text-emerald-700"
      : status === "in_arbeit"
        ? "bg-amber-100 text-amber-700"
        : "bg-gray-200 text-gray-600";
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {taskStatusLabel(status)}
    </span>
  );
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const { role } = await getEffectiveRole();
  const allowedModules = await getAllowedModules(role);
  const canSeeOverdue = allowedModules.includes("ueberfaellige_aufgaben");
  let tasks: Awaited<ReturnType<typeof listTasksAssignedTo>> = [];
  let overdueAll: Awaited<ReturnType<typeof listAllOverdueTasks>> = [];
  let error: string | null = null;
  try {
    const me = await getUserByUsername(session.username);
    if (me) tasks = await listTasksAssignedTo(me.id);
    if (canSeeOverdue) overdueAll = await listAllOverdueTasks();
  } catch (e) {
    error = e instanceof Error ? e.message : "Aufgaben konnten nicht geladen werden.";
  }

  let pipeline: Awaited<ReturnType<typeof getProjectPipeline>> | null = null;
  try {
    pipeline = await getProjectPipeline();
  } catch {
    // Pipeline ist optional – Fehler hier blockiert das Dashboard nicht.
  }

  const openCount = tasks.filter((t) => t.status !== "erledigt").length;

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
      </header>

      <div className="max-w-2xl rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            Meine Aufgaben{" "}
            <span className="text-sm font-normal text-gray-500">({openCount} offen)</span>
          </h2>
          <Link href="/dashboard/aufgaben" className="text-sm font-medium text-brand-red hover:underline">
            Alle verwalten →
          </Link>
        </div>

        {error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-gray-400">Dir sind aktuell keine Aufgaben zugewiesen.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {tasks.map((t) => {
              const overdue = isOverdue(t.dueDate, t.status);
              return (
                <li
                  key={t.id}
                  className={`flex items-start justify-between gap-3 py-2.5 ${
                    t.status === "erledigt" ? "opacity-60" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{t.title}</p>
                    <p className="truncate text-xs text-gray-500">
                      von {t.createdByName}
                      {t.dueDate && (
                        <span className={overdue ? "font-semibold text-rose-600" : ""}>
                          {" · "}fällig {formatDate(t.dueDate)}
                          {overdue ? " (überfällig)" : ""}
                        </span>
                      )}
                    </p>
                  </div>
                  <StatusBadge status={t.status} />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {canSeeOverdue && (
        <div className="max-w-2xl rounded-xl border border-rose-300 bg-white p-5 shadow-lg shadow-black/10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              Überfällige Aufgaben (Unternehmen){" "}
              <span className="text-sm font-normal text-rose-600">({overdueAll.length})</span>
            </h2>
            <Link
              href="/dashboard/aufgaben"
              className="text-sm font-medium text-brand-red hover:underline"
            >
              Alle verwalten →
            </Link>
          </div>

          {overdueAll.length === 0 ? (
            <p className="text-sm text-gray-400">Keine überfälligen Aufgaben. 🎉</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {overdueAll.map((t) => (
                <li key={t.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{t.title}</p>
                    <p className="truncate text-xs text-gray-500">
                      an {t.assignees.map((a) => a.name).join(", ") || "—"} · von {t.createdByName}
                      <span className="font-semibold text-rose-600">
                        {" · "}fällig {formatDate(t.dueDate)}
                      </span>
                    </p>
                  </div>
                  <StatusBadge status={t.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {pipeline && (
        <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
          <h2 className="mb-4 text-lg font-medium text-gray-900">Projekt-Pipeline</h2>
          <ProjectPipelines pipeline={pipeline} />
        </div>
      )}
    </div>
  );
}
