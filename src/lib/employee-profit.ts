import {
  getInvoiceNetByProject,
  getCalculatedByProject,
  getHoursByProjectAndEmployee,
  getEvaluableProjectIds,
  getProjects,
} from "./hero-api";
import { getCostNetByProject } from "./invoices";

export interface EmployeeProjectContribution {
  projectId: number;
  projectName: string;
  projectRelativeId: number | null;
  /** Hours the employee worked on the project. */
  hours: number;
  /** Total project profit (Ist-Ertrag). */
  projectProfit: number;
  /** Employee's hour share of the project, in percent. */
  sharePct: number;
  /** Profit allocated to the employee from this project. */
  profit: number;
}

export interface EmployeeProfitRow {
  employeeId: number;
  employeeName: string;
  /** Worked hours (on profit-bearing projects). */
  hours: number;
  /** Allocated profit = sum over projects of Ist-Ertrag × hour share. */
  profit: number;
  /** Allocated revenue share (for context). */
  revenue: number;
  /** Profit per worked hour. */
  profitPerHour: number;
  /** Per-project breakdown of the allocated profit. */
  projects: EmployeeProjectContribution[];
}

export interface EmployeeProfitData {
  rows: EmployeeProfitRow[];
  /** Project profit that could be allocated (projects with tracked hours). */
  allocatedProfit: number;
  /** Profit on projects without tracked hours (not attributable). */
  unallocatedProfit: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Mitarbeiterbewertung am Gewinn: nutzt die Projektgewinn-Rechnung der
 * Projektliste (Ist-Ertrag = Rechnungen − Ist-Material − Ist-Lohn) und verteilt
 * den Projektgewinn auf die Mitarbeiter nach ihrem Anteil an den geleisteten
 * Stunden. Ist-Lohn = Ist-Stunden × Satz (Satz = Soll-Lohn / Kalk.-Stunden).
 */
export async function getEmployeeProfit(year: number): Promise<EmployeeProfitData> {
  const [invoiceNet, costNet, calc, hours, completed, projects] = await Promise.all([
    getInvoiceNetByProject(),
    getCostNetByProject(),
    getCalculatedByProject(),
    getHoursByProjectAndEmployee(),
    getEvaluableProjectIds(year),
    getProjects(),
  ]);

  const projectMeta = new Map(projects.map((p) => [p.id, p]));

  // Nur Projekte berücksichtigen, die im Jahr abgeschlossen wurden oder in
  // Nachkalkulation sind.
  const projectIds = completed;

  type Acc = {
    hours: number;
    profit: number;
    revenue: number;
    projects: EmployeeProjectContribution[];
  };
  const acc = new Map<number, Acc>();
  let allocatedProfit = 0;
  let unallocatedProfit = 0;

  for (const pid of projectIds) {
    const rev = invoiceNet.get(pid) ?? 0;
    const cost = costNet.get(pid) ?? 0;
    const c = calc.get(pid);
    const rate = c && c.hours > 0 ? c.laborCost / c.hours : 0;

    const emps = hours.byProject.get(pid);
    const projHours = emps ? [...emps.values()].reduce((s, h) => s + h, 0) : 0;
    const istLabor = projHours * rate;
    const profit = rev - cost - istLabor;

    if (projHours <= 0 || !emps) {
      unallocatedProfit += profit;
      continue;
    }
    allocatedProfit += profit;
    const meta = projectMeta.get(pid);
    for (const [empId, h] of emps) {
      const share = h / projHours;
      const cur = acc.get(empId) ?? { hours: 0, profit: 0, revenue: 0, projects: [] };
      cur.hours += h;
      cur.profit += profit * share;
      cur.revenue += rev * share;
      cur.projects.push({
        projectId: pid,
        projectName: meta?.name ?? `Projekt ${pid}`,
        projectRelativeId: meta?.relativeId ?? null,
        hours: round2(h),
        projectProfit: round2(profit),
        sharePct: round2(share * 100),
        profit: round2(profit * share),
      });
      acc.set(empId, cur);
    }
  }

  const rows: EmployeeProfitRow[] = [...acc.entries()]
    .map(([empId, v]) => ({
      employeeId: empId,
      employeeName: hours.names.get(empId) ?? "Unbekannt",
      hours: round2(v.hours),
      profit: round2(v.profit),
      revenue: round2(v.revenue),
      profitPerHour: v.hours > 0 ? round2(v.profit / v.hours) : 0,
      projects: v.projects.sort((a, b) => b.profit - a.profit),
    }))
    .sort((a, b) => b.profit - a.profit);

  return {
    rows,
    allocatedProfit: round2(allocatedProfit),
    unallocatedProfit: round2(unallocatedProfit),
  };
}
