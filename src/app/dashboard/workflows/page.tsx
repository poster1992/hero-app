import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listUsers } from "@/lib/users";
import { listWorkflows, listWorkflowLog, type Workflow, type WorkflowLogItem } from "@/lib/workflows";
import WorkflowsManager from "@/components/WorkflowsManager";

export default async function WorkflowsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "administrator") {
    return (
      <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
        <h1 className="text-2xl font-semibold text-gray-900">Workflows</h1>
        <p className="text-sm text-gray-500">Nur für Administratoren.</p>
      </div>
    );
  }

  let workflows: Workflow[] = [];
  let log: WorkflowLogItem[] = [];
  let users: { id: number; name: string }[] = [];
  try {
    const [wf, lg, us] = await Promise.all([listWorkflows(), listWorkflowLog(30), listUsers()]);
    workflows = wf;
    log = lg;
    users = us.filter((u) => u.isActive).map((u) => ({ id: u.id, name: u.displayName || u.username }));
  } catch {
    // leer lassen
  }

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Workflows</h1>
        <p className="mt-1 text-sm text-gray-600">
          Automatische Regeln: Auslöser → Aktion. Aktuell: bei neuen Belegen automatisch eine
          Aufgabe erstellen. Prüfung erfolgt bei App-Nutzung (alle paar Minuten).
        </p>
      </header>
      <WorkflowsManager workflows={workflows} users={users} log={log} />
    </div>
  );
}
