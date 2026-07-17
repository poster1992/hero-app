import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listUsers } from "@/lib/users";
import {
  listWorkflows,
  listWorkflowLog,
  listWorkflowRuns,
  type Workflow,
  type WorkflowLogItem,
  type WorkflowRun,
} from "@/lib/workflows";
import { getDistinctSuppliers } from "@/lib/invoices";
import { getCustomers, getBookAccounts } from "@/lib/hero-api";
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
  let runs: WorkflowRun[] = [];
  let users: { id: number; name: string }[] = [];
  let suppliers: string[] = [];
  let customers: string[] = [];
  let accounts: { number: string; name: string }[] = [];
  try {
    const [wf, lg, rn, us] = await Promise.all([
      listWorkflows(),
      listWorkflowLog(30),
      listWorkflowRuns(30),
      listUsers(),
    ]);
    workflows = wf;
    log = lg;
    runs = rn;
    users = us.filter((u) => u.isActive).map((u) => ({ id: u.id, name: u.displayName || u.username }));
  } catch {
    // leer lassen
  }
  try {
    suppliers = await getDistinctSuppliers();
  } catch {
    // Lieferantenliste optional
  }
  try {
    const cs = await getCustomers();
    customers = Array.from(
      new Set(cs.flatMap((c) => [c.name, c.companyName].filter((s): s is string => !!s?.trim())))
    ).sort((a, b) => a.localeCompare(b, "de"));
  } catch {
    // Kundenliste optional
  }
  try {
    accounts = (await getBookAccounts()).map((a) => ({ number: a.number, name: a.name }));
  } catch {
    // Kontenliste optional
  }

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Workflows</h1>
        <p className="mt-1 text-sm text-gray-600">
          Automatische Regeln: Auslöser → Aktion. Die Prüfung läuft automatisch alle 10 Minuten
          (serverseitig) sowie bei App-Nutzung. Jeder Lauf wird in der Dienst-Historie protokolliert.
        </p>
      </header>
      <WorkflowsManager workflows={workflows} users={users} log={log} runs={runs} suppliers={suppliers} customers={customers} accounts={accounts} />
    </div>
  );
}
