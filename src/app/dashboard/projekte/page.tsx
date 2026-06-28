import ProjectsTable, { type ProjectRow } from "@/components/ProjectsTable";
import {
  getProjects,
  getConfirmationNetByProject,
  getInvoiceNetByProject,
  getHoursByProject,
  getCalculatedByProject,
} from "@/lib/hero-api";
import { getCostNetByProject } from "@/lib/invoices";
import { getBookedStockTotalsByProject } from "@/lib/materials";

export default async function ProjektePage() {
  let rows: ProjectRow[] | null = null;
  let error: string | null = null;
  try {
    const [projects, confirmationNet, invoiceNet, costNet, hours, calc, stockByProject] =
      await Promise.all([
        getProjects(),
        getConfirmationNetByProject(),
        getInvoiceNetByProject(),
        getCostNetByProject(),
        getHoursByProject(),
        getCalculatedByProject(),
        getBookedStockTotalsByProject().catch(() => new Map<number, number>()),
      ]);
    rows = projects.map((p) => ({
      ...p,
      confirmationNet: confirmationNet.get(p.id)?.net ?? 0,
      confirmationDate: confirmationNet.get(p.id)?.date ?? null,
      invoiceNet: invoiceNet.get(p.id) ?? 0,
      costNet: costNet.get(p.id) ?? 0,
      stockNet: p.relativeId != null ? stockByProject.get(p.relativeId) ?? 0 : 0,
      hours: hours.get(p.id) ?? 0,
      calcHours: calc.get(p.id)?.hours ?? 0,
      calcMaterial: calc.get(p.id)?.material ?? 0,
      sollLabor: calc.get(p.id)?.laborCost ?? 0,
    }));
  } catch (e) {
    error = e instanceof Error ? e.message : "Unbekannter Fehler beim Laden der Daten.";
  }

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Projekte</h1>
      </header>

      {error && (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          Fehler beim Laden der Daten von HERO: {error}
        </div>
      )}

      {rows && <ProjectsTable projects={rows} />}
    </div>
  );
}
