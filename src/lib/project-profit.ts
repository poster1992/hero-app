import {
  getProjects,
  getInvoiceNetByProject,
  getHoursByProject,
  getCalculatedByProject,
} from "./hero-api";
import { getCostNetByProject } from "./invoices";
import { getBookedStockTotalsByProject } from "./materials";

export interface ProjectProfit {
  id: number;
  relativeId: number | null;
  name: string;
  customerName: string | null;
  /** Geleistete Ist-Stunden. */
  hours: number;
  /** Rechnungen netto. */
  revenue: number;
  /** Ist-Material netto (Belege + aufs Projekt gebuchte Lagerware). */
  cost: number;
  /** Ist-Lohn = Ist-Stunden × kalkulierter Stundensatz. */
  labor: number;
  /** Ist-Ertrag = revenue − cost − labor. */
  profit: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Gewinn/Verlust je Projekt (Ist-Ertrag), wie in der Projektliste:
 * Rechnungen − Ist-Material − Ist-Lohn (Ist-Lohn = Ist-Stunden × Satz,
 * Satz = Soll-Lohnkosten / Kalk.-Stunden). Lifetime, nicht jahresscharf.
 */
export async function getProjectProfits(): Promise<ProjectProfit[]> {
  const [projects, invoiceNet, costNet, hours, calc, stock] = await Promise.all([
    getProjects(),
    getInvoiceNetByProject(),
    getCostNetByProject(),
    getHoursByProject(),
    getCalculatedByProject(),
    getBookedStockTotalsByProject().catch(() => new Map<number, number>()),
  ]);

  return projects.map((p) => {
    const rev = invoiceNet.get(p.id) ?? 0;
    // Ist-Material = Belege (nach match-id) + gebuchte Lagerware (nach relative_id).
    const stockVal = p.relativeId != null ? stock.get(p.relativeId) ?? 0 : 0;
    const cost = (costNet.get(p.id) ?? 0) + stockVal;
    const c = calc.get(p.id);
    const rate = c && c.hours > 0 ? c.laborCost / c.hours : 0;
    const projHours = hours.get(p.id) ?? 0;
    const labor = projHours * rate;
    return {
      id: p.id,
      relativeId: p.relativeId,
      name: p.name,
      customerName: p.customerName,
      hours: round2(projHours),
      revenue: round2(rev),
      cost: round2(cost),
      labor: round2(labor),
      profit: round2(rev - cost - labor),
    };
  });
}
