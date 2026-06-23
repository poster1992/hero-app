import type Anthropic from "@anthropic-ai/sdk";
import { getDashboardData } from "./dashboard-data";
import { getEmployeeProfit } from "./employee-profit";
import { getOfferConfirmationVolume } from "./hero-api";
import { getStockOutboundReport } from "./materials";
import { getProjectProfits } from "./project-profit";
import { addMemory, listMemories, deleteMemory } from "./ai-memory";

const round2 = (n: number) => Math.round(n * 100) / 100;
const currentYear = () => new Date().getUTCFullYear();

/** Tool definitions the data assistant may call. All read-only. */
export const TOOLS: Anthropic.Tool[] = [
  {
    name: "unternehmensuebersicht",
    description:
      "Liefert die Finanzübersicht eines Jahres: Umsatz (Ausgangsrechnungen netto), Belege/Kosten netto, Saldo, Gewinn in % vom Umsatz, offene Rechnungen und offene Belege (brutto + Anzahl), Umsatz/Belege je Monat sowie die größten Aufwands-Buchungskonten (GuV). Für Fragen zu Umsatz, Kosten, Gewinn, Saldo, offenen Posten und monatlicher Entwicklung.",
    input_schema: {
      type: "object",
      properties: {
        jahr: { type: "integer", description: "Geschäftsjahr, z. B. 2026. Standard: aktuelles Jahr." },
      },
    },
  },
  {
    name: "angebote_auftraege",
    description:
      "Liefert für ein Jahr das Angebotsvolumen, die Auftragsbestätigungen, den bereits verrechneten Betrag sowie Auftragsquote (Aufträge ÷ Angebote) und Verrechnungsgrad (verrechnet ÷ Auftragsbestätigungen) in Prozent.",
    input_schema: {
      type: "object",
      properties: {
        jahr: { type: "integer", description: "Geschäftsjahr, z. B. 2026. Standard: aktuelles Jahr." },
      },
    },
  },
  {
    name: "mitarbeiterbewertung",
    description:
      "Liefert die Bewertung der Mitarbeiter am Gewinn für ein Jahr: je Mitarbeiter geleistete Stunden, zugeordneter Gewinn und Gewinn pro Stunde, sortiert nach Gewinn. Berücksichtigt im Jahr abgeschlossene Projekte und Projekte in Nachkalkulation.",
    input_schema: {
      type: "object",
      properties: {
        jahr: { type: "integer", description: "Geschäftsjahr, z. B. 2026. Standard: aktuelles Jahr." },
      },
    },
  },
  {
    name: "lagerausgang",
    description:
      "Liefert den Warenwert (EK) des Lagerausgangs für heute, diese Woche und diesen Monat.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "notiz_speichern",
    description:
      "Speichert eine dauerhafte Notiz ins Gedächtnis (über Sitzungen hinweg). Nutze dies, wenn der Nutzer dir etwas beibringt oder bittet, dir etwas zu merken: Begriffe/Definitionen, Regeln, Vorlieben oder wiederkehrende Fakten. Formuliere die Notiz knapp und eigenständig verständlich.",
    input_schema: {
      type: "object",
      properties: {
        inhalt: { type: "string", description: "Die zu merkende Information, knapp formuliert." },
      },
      required: ["inhalt"],
    },
  },
  {
    name: "notizen_auflisten",
    description: "Listet alle gespeicherten Gedächtnis-Notizen (mit IDs) auf.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "notiz_loeschen",
    description:
      "Löscht eine Gedächtnis-Notiz anhand ihrer ID (z. B. wenn sie veraltet oder falsch ist).",
    input_schema: {
      type: "object",
      properties: { id: { type: "integer", description: "ID der zu löschenden Notiz." } },
      required: ["id"],
    },
  },
  {
    name: "projekte_ohne_abschlagsrechnung",
    description:
      "Listet Projekte, auf denen bereits Ist-Stunden verbucht wurden, für die aber noch KEINE Rechnung/Abschlagsrechnung erstellt wurde (Rechnungen netto = 0). Für Fragen wie 'welche Projekte sind noch nicht abgerechnet/fakturiert' oder 'wo wurden Stunden gebucht, aber noch keine Abschlagsrechnung gestellt'. Lifetime.",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "Maximale Anzahl gelisteter Projekte (Standard 50).",
        },
        suche: {
          type: "string",
          description: "Optionaler Filter auf Projektname/Kunde (Teilstring).",
        },
      },
    },
  },
  {
    name: "projekte_gewinn",
    description:
      "Gewinn/Verlust je Projekt (Ist-Ertrag = Rechnungen − Ist-Material − Ist-Lohn). Für Fragen wie 'welche Projekte sind im Minus/Verlust', profitabelste oder unprofitabelste Projekte, Gewinn eines bestimmten Projekts. Lifetime über alle Projekte (nicht jahresscharf).",
    input_schema: {
      type: "object",
      properties: {
        nur_verlust: {
          type: "boolean",
          description: "Wenn true, nur Projekte mit Verlust (Ist-Ertrag < 0).",
        },
        sortierung: {
          type: "string",
          enum: ["gewinn_aufsteigend", "gewinn_absteigend"],
          description:
            "Sortierung; 'gewinn_aufsteigend' = Verlustbringer zuerst (Standard).",
        },
        limit: {
          type: "integer",
          description: "Maximale Anzahl gelisteter Projekte (Standard 50).",
        },
        suche: {
          type: "string",
          description: "Optionaler Filter auf Projektname/Kunde (Teilstring).",
        },
      },
    },
  },
];

/** Executes a tool call against the existing data layer and returns a compact result. */
export async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  const jahr = Number.isFinite(Number(input?.jahr)) ? Number(input.jahr) : currentYear();

  switch (name) {
    case "unternehmensuebersicht": {
      const d = await getDashboardData(jahr);
      return {
        jahr: d.year,
        umsatz_netto: d.totalIncome,
        belege_kosten_netto: d.totalOutput,
        saldo: round2(d.totalIncome - d.totalOutput),
        gewinn_prozent_vom_umsatz: d.marginRatio,
        offene_rechnungen: { brutto: d.openInvoicesTotal, anzahl: d.openInvoicesCount },
        offene_belege: { brutto: d.openReceiptsTotal, anzahl: d.openReceiptsCount },
        monatlich: d.monthly.map((m) => ({ monat: m.label, umsatz: m.income, belege: m.output })),
        groesste_aufwandskonten: d.guv.expenseAccounts.slice(0, 10).map((a) => ({
          konto_nr: a.accountNumber || null,
          bezeichnung: a.accountName,
          summe_netto: a.total,
        })),
      };
    }
    case "angebote_auftraege": {
      const v = await getOfferConfirmationVolume(jahr);
      return {
        jahr,
        angebotsvolumen: v.offers,
        auftragsbestaetigungen: v.confirmations,
        verrechnet: v.invoiced,
        auftragsquote_prozent: v.offers > 0 ? round2((v.confirmations / v.offers) * 100) : 0,
        verrechnungsgrad_prozent:
          v.confirmations > 0 ? round2((v.invoiced / v.confirmations) * 100) : 0,
      };
    }
    case "mitarbeiterbewertung": {
      const e = await getEmployeeProfit(jahr);
      return {
        jahr,
        zugeordneter_gewinn: e.allocatedProfit,
        nicht_zugeordneter_gewinn: e.unallocatedProfit,
        mitarbeiter: e.rows.map((r) => ({
          name: r.employeeName,
          stunden: r.hours,
          gewinn: r.profit,
          gewinn_pro_stunde: r.profitPerHour,
        })),
      };
    }
    case "lagerausgang": {
      const s = await getStockOutboundReport();
      return {
        lagerausgang_ek: {
          heute: s.totals.daily,
          diese_woche: s.totals.weekly,
          dieser_monat: s.totals.monthly,
        },
      };
    }
    case "notiz_speichern": {
      const inhalt = typeof input?.inhalt === "string" ? input.inhalt : "";
      const id = await addMemory(inhalt, null);
      return id > 0 ? { gespeichert: true, id } : { gespeichert: false, grund: "leerer Inhalt" };
    }
    case "notizen_auflisten": {
      const items = await listMemories();
      return { notizen: items.map((m) => ({ id: m.id, inhalt: m.content })) };
    }
    case "notiz_loeschen": {
      const id = Number(input?.id);
      if (!Number.isFinite(id) || id <= 0) return { geloescht: false, grund: "ungültige ID" };
      await deleteMemory(id);
      return { geloescht: true, id };
    }
    case "projekte_ohne_abschlagsrechnung": {
      const suche = typeof input?.suche === "string" ? input.suche.trim().toLowerCase() : "";
      const limit = Number.isFinite(Number(input?.limit)) ? Math.max(1, Number(input.limit)) : 50;

      const all = await getProjectProfits();
      // Ist-Stunden vorhanden, aber keine Rechnung gestellt.
      let list = all.filter((p) => p.hours > 0 && p.revenue <= 0.005);
      if (suche) {
        list = list.filter(
          (p) =>
            p.name.toLowerCase().includes(suche) ||
            (p.customerName?.toLowerCase().includes(suche) ?? false)
        );
      }
      list = [...list].sort((a, b) => b.hours - a.hours);

      return {
        anzahl: list.length,
        summe_ist_stunden: round2(list.reduce((s, p) => s + p.hours, 0)),
        summe_ist_lohnwert: round2(list.reduce((s, p) => s + p.labor, 0)),
        hinweis:
          "Projekte mit verbuchten Ist-Stunden, aber ohne Rechnung/Abschlagsrechnung (Rechnungen netto = 0). Lifetime.",
        projekte: list.slice(0, limit).map((p) => ({
          nr: p.relativeId,
          name: p.name,
          kunde: p.customerName,
          ist_stunden: p.hours,
          ist_lohnwert: p.labor,
          ist_material: p.cost,
        })),
      };
    }
    case "projekte_gewinn": {
      const nurVerlust = input?.nur_verlust === true;
      const suche = typeof input?.suche === "string" ? input.suche.trim().toLowerCase() : "";
      const limit = Number.isFinite(Number(input?.limit)) ? Math.max(1, Number(input.limit)) : 50;
      const sortAsc = input?.sortierung !== "gewinn_absteigend";

      const all = await getProjectProfits();
      // Nur Projekte mit Aktivität (Umsatz, Kosten oder Lohn vorhanden).
      const active = all.filter((p) => p.revenue !== 0 || p.cost !== 0 || p.labor !== 0);
      const verlust = active.filter((p) => p.profit < 0);

      let list = nurVerlust ? verlust : active;
      if (suche) {
        list = list.filter(
          (p) =>
            p.name.toLowerCase().includes(suche) ||
            (p.customerName?.toLowerCase().includes(suche) ?? false)
        );
      }
      list = [...list].sort((a, b) => (sortAsc ? a.profit - b.profit : b.profit - a.profit));

      return {
        anzahl_projekte_mit_aktivitaet: active.length,
        anzahl_im_minus: verlust.length,
        summe_verlust: round2(verlust.reduce((s, p) => s + p.profit, 0)),
        hinweis: "Werte lifetime (nicht jahresscharf); Ist-Ertrag = Rechnungen − Ist-Material − Ist-Lohn.",
        projekte: list.slice(0, limit).map((p) => ({
          nr: p.relativeId,
          name: p.name,
          kunde: p.customerName,
          rechnungen_netto: p.revenue,
          ist_material: p.cost,
          ist_lohn: p.labor,
          ist_ertrag: p.profit,
        })),
      };
    }
    default:
      return { error: `Unbekanntes Werkzeug: ${name}` };
  }
}
