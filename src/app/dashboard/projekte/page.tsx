import ProjectsTable, { type ProjectRow } from "@/components/ProjectsTable";
import {
  getProjects,
  getConfirmationNetByProject,
  getOfferNetByProject,
  getInvoiceNetByProject,
  getHoursByProject,
  getCalculatedByProject,
  getOfferCalculatedByProject,
} from "@/lib/hero-api";
import { getCostNetByProject } from "@/lib/invoices";
import { getBookedStockTotalsByProject } from "@/lib/materials";
import { getSession } from "@/lib/session";
import { getAllowedModules } from "@/lib/role-store";

export default async function ProjektePage() {
  const session = await getSession();
  // Finanz-Ansicht (Kosten/Ertrag/Belege) nur mit dem Recht „projekte_finanzen"
  // – Administratoren sehen immer alles.
  let canFinance = session?.role === "administrator";
  if (!canFinance && session) {
    try {
      canFinance = (await getAllowedModules(session.role)).includes("projekte_finanzen");
    } catch {
      canFinance = false;
    }
  }

  let rows: ProjectRow[] | null = null;
  let error: string | null = null;
  try {
    const [
      projects,
      confirmationNet,
      offerNet,
      invoiceNet,
      costNet,
      hours,
      calc,
      offerCalc,
      stockByProject,
    ] = await Promise.all([
      getProjects(),
      getConfirmationNetByProject(),
      getOfferNetByProject(),
      getInvoiceNetByProject(),
      getCostNetByProject(),
      getHoursByProject(),
      getCalculatedByProject(),
      getOfferCalculatedByProject(),
      getBookedStockTotalsByProject().catch(() => new Map<number, number>()),
    ]);
    rows = projects.map((p) => {
      // Gibt es eine Auftragsbestätigung? Dann Auftrag; sonst Fallback auf das Angebot.
      const hasAB = confirmationNet.has(p.id);
      const hasOffer = offerNet.has(p.id);
      const basis: "auftrag" | "angebot" | "keine" = hasAB ? "auftrag" : hasOffer ? "angebot" : "keine";
      // Netto/Datum und Kalkulation aus der passenden Quelle (AB oder Angebot).
      const netInfo = hasAB ? confirmationNet.get(p.id) : offerNet.get(p.id);
      const c = hasAB ? calc.get(p.id) : offerCalc.get(p.id);
      return {
        ...p,
        basis,
        confirmationNet: netInfo?.net ?? 0,
        confirmationDate: netInfo?.date ?? null,
        invoiceNet: invoiceNet.get(p.id) ?? 0,
        costNet: costNet.get(p.id) ?? 0,
        stockNet: p.relativeId != null ? stockByProject.get(p.relativeId) ?? 0 : 0,
        hours: hours.get(p.id) ?? 0,
        calcHours: c?.hours ?? 0,
        calcMaterial: c?.material ?? 0,
        sollLabor: c?.laborCost ?? 0,
      };
    });
    // Ohne Finanz-Recht: sensible Kostenwerte gar nicht erst zum Client senden.
    // (Auftrag/Rechnungen/Offen und Stunden bleiben; Material-Kosten, Lohn,
    // Lagerware und der daraus abgeleitete Ertrag entfallen.)
    if (!canFinance) {
      rows = rows.map((r) => ({
        ...r,
        costNet: 0,
        calcMaterial: 0,
        sollLabor: 0,
        stockNet: 0,
      }));
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Unbekannter Fehler beim Laden der Daten.";
  }

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Projekte</h1>
      </header>

      {error && (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-brand-red-dark">
          Fehler beim Laden der Daten von HERO: {error}
        </div>
      )}

      {rows && <ProjectsTable projects={rows} canFinance={canFinance} />}
    </div>
  );
}
