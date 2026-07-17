import "server-only";
import {
  getReceiptsInRange,
  getProjectPipeline,
  getProjects,
  getProjectHourDetails,
  getInvoiceNetByProject,
  getCustomerInvoices,
  type Receipt,
  type ProjectSummary,
  type ProjectHourDetail,
  type CustomerInvoice,
} from "./hero-api";
import { getCustomerName, getDocumentUrl, getReceiptProjects } from "./invoices";
import { listInboxReceipts, getManualReceipt, getManualDuplicateKeys } from "./manual-receipts";
import { receiptDupKey } from "./receipt-duplicates";
import { getLagerMinStatus } from "./materials";
import { createTask, createReviewTask } from "./tasks";
import { assignReviewer, getReceiptReview } from "./receipt-reviews";
import { sendPushToUsers } from "./push";
import { createTaskNotification } from "./task-notifications";
import { getUsersForNotification } from "./users";
import { sendMail } from "./mailer";
import { getGlobalLogbookSystem, addProjectLogbookEntry, SYSTEM_TITLE_RE } from "./logbook-core";
import { buildBaustelleFertigEmailHtml, buildBaustelleFertigEmailText } from "./workflow-mail";
import {
  listActiveWorkflows,
  getWorkflowMeta,
  touchWorkflowLastRun,
  getRuleSeen,
  markRuleSeen,
  unmarkRuleSeen,
  addWorkflowLog,
  addWorkflowRun,
  WORKFLOW_TRIGGER_KEYS,
  type Workflow,
  type WorkflowConfig,
} from "./workflows";

const THROTTLE_MS = 5 * 60 * 1000;
const MAX_PER_RUN = 25; // Schutz vor Flut beim ersten Lauf

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const hoursFmt = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Ein Auslöser-Ereignis (z.B. ein neuer Beleg oder ein zu altes Angebot). */
interface WfEvent {
  ref: string;
  supplier: string; // für filterSupplier (Lieferant/Kunde)
  amount: number; // für filterMinAmount
  hasDoc?: boolean; // Beleg hat ein Dokument (für „manuelle Belege ausschließen")
  ageDays?: number; // für Altersfilter
  eventDate?: string | null; // YYYY-MM-DD (Beleg- bzw. Angebotsdatum), für „gilt ab"
  note?: string; // Zusatzinfo, die der Aufgaben-Beschreibung angehängt wird
  // Projektbezug (für logbuch_abschluss: Aufgabe + Logbuch-Notiz + Mail-Link).
  projectId?: number | null;
  projectRelativeId?: number | null;
  projectName?: string | null;
  author?: string | null; // Verfasser des Logbuch-Eintrags (für die Mail)
  fill: (tpl: string) => string; // Titel-Vorlage füllen
  /** Beleg-Daten für die Aktion „Rechnungsprüfung" (nur new_beleg). */
  review?: {
    heroId: string;
    number: string;
    supplier: string;
    gross: number;
    docUrl: string | null;
    projectMatchId: number | null;
    projectRelativeId: number | null;
    projectName: string | null;
  };
}

function reviewLabel(rv: { number: string; supplier: string; gross: number }): string {
  const base = [rv.number, rv.supplier].filter(Boolean).join(" · ") || "Beleg";
  return rv.gross ? `${base} · ${euro.format(rv.gross)}` : base;
}

function fillBeleg(tpl: string, r: Receipt, supplier: string): string {
  return tpl
    .replace(/\{nr\}/g, r.number || "")
    .replace(/\{lieferant\}/g, supplier || "")
    .replace(/\{betrag\}/g, euro.format(r.value || 0))
    .replace(/\{datum\}/g, r.receiptDate ? r.receiptDate.slice(0, 10) : "");
}

function fillAngebot(
  tpl: string,
  p: { name: string; relativeId: number | null; customerName: string | null; offerSum: number; offerDate: string | null },
  ageDays: number
): string {
  return tpl
    .replace(/\{projekt\}/g, p.name || "")
    .replace(/\{nr\}/g, p.relativeId != null ? `#${p.relativeId}` : "")
    .replace(/\{kunde\}/g, p.customerName || "")
    .replace(/\{betrag\}/g, euro.format(p.offerSum || 0))
    .replace(/\{angebotsdatum\}/g, p.offerDate ? p.offerDate.slice(0, 10) : "")
    .replace(/\{tage\}/g, String(ageDays));
}

function fmtDay(d: string | null): string {
  return d ? d.split("-").reverse().join(".") : "";
}

/** "Max (12,5 h), Erika (3,0 h)" – Mitarbeiter mit erfassten Stunden. */
function employeesText(d: ProjectHourDetail): string {
  return d.employees.map((e) => `${e.name} (${hoursFmt.format(e.hours)} h)`).join(", ");
}

/** "01.05.2026 – 20.06.2026" bzw. einzelnes Datum. */
function zeitraumText(d: ProjectHourDetail): string {
  if (!d.firstDate && !d.lastDate) return "";
  if (d.firstDate === d.lastDate) return fmtDay(d.firstDate);
  return `${fmtDay(d.firstDate)} – ${fmtDay(d.lastDate)}`;
}

const RECHNUNG_DOCUMENT_TYPE_ID = 1057585; // echte Kundenrechnung (nicht Gutschrift/Storno)
// Rechnungsart (metadata.invoice_style): nur Endrechnungen sollen den Anruf auslösen.
// "full" = Vollrechnung, "cumulative" = kumulative Schlussrechnung.
// (ausgeschlossen: "parted" = Teilrechnung, "downpayment" = Abschlagsrechnung)
const ENDRECHNUNG_STYLES = new Set(["full", "cumulative"]);

function fillEndrechnung(tpl: string, inv: CustomerInvoice): string {
  return tpl
    .replace(/\{kunde\}/g, inv.customerName || "")
    .replace(/\{nr\}/g, inv.number || "")
    .replace(/\{projekt\}/g, inv.project?.name || "")
    .replace(/\{betrag\}/g, euro.format(inv.net || inv.gross || 0))
    .replace(/\{datum\}/g, inv.date ? inv.date.slice(0, 10) : "");
}

function fillStunden(tpl: string, p: ProjectSummary, det: ProjectHourDetail): string {
  return tpl
    .replace(/\{projekt\}/g, p.name || "")
    .replace(/\{nr\}/g, p.relativeId != null ? `#${p.relativeId}` : "")
    .replace(/\{kunde\}/g, p.customerName || "")
    .replace(/\{stunden\}/g, hoursFmt.format(det.hours))
    .replace(/\{mitarbeiter\}/g, employeesText(det))
    .replace(/\{zeitraum\}/g, zeitraumText(det));
}

// --- Wiederkehrende Aufgaben (Auslöser "wiederkehrend") ---

const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" → Date (UTC-Mitternacht, damit Zeitzonen nicht ins Datum hineinrutschen). */
function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function dateToIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Heutiges Datum in der Zeitzone des Servers. */
function todayIso(): string {
  const n = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
}

/**
 * Der zuletzt fällige Termin einer wiederkehrenden Regel (≤ heute), oder null,
 * wenn noch keiner fällig war.
 *
 * Bewusst nur der LETZTE Termin und nicht alle seit Start: Sonst würde eine
 * täglich laufende Regel, die eine Weile pausiert war, beim nächsten Lauf den
 * gesamten Zeitraum nachträglich als Aufgaben-Schwall anlegen.
 */
export function lastDueOccurrence(
  cfg: Pick<WorkflowConfig, "repeatKind" | "repeatWeekday" | "repeatDayOfMonth" | "repeatEveryDays">,
  startIso: string,
  todayStr: string = todayIso()
): string | null {
  const today = isoToDate(todayStr);
  const start = isoToDate(startIso);
  if (today < start) return null;

  let occ: Date;

  switch (cfg.repeatKind) {
    case "daily":
      occ = today;
      break;

    case "weekly": {
      // config: 1 = Montag … 7 = Sonntag; JS: 0 = Sonntag … 6 = Samstag.
      const targetJsDay = cfg.repeatWeekday % 7;
      const backDays = (today.getUTCDay() - targetJsDay + 7) % 7;
      occ = new Date(today.getTime() - backDays * DAY_MS);
      break;
    }

    case "monthly": {
      // Tag im Monat; kürzere Monate (z.B. „31." im Februar) nehmen den letzten Tag.
      const dayIn = (year: number, month: number) => {
        const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        return new Date(Date.UTC(year, month, Math.min(cfg.repeatDayOfMonth, lastDay)));
      };
      occ = dayIn(today.getUTCFullYear(), today.getUTCMonth());
      if (occ > today) {
        // Der Termin dieses Monats liegt noch in der Zukunft → der aus dem Vormonat gilt.
        occ = dayIn(today.getUTCFullYear(), today.getUTCMonth() - 1);
      }
      break;
    }

    case "interval": {
      const every = Math.max(1, cfg.repeatEveryDays);
      const elapsed = Math.floor((today.getTime() - start.getTime()) / DAY_MS);
      occ = new Date(start.getTime() + Math.floor(elapsed / every) * every * DAY_MS);
      break;
    }

    default:
      return null;
  }

  // Termine vor dem Start der Regel zählen nicht.
  return occ < start ? null : dateToIso(occ);
}

/** Das (höchstens eine) fällige Ereignis einer wiederkehrenden Regel. */
function recurringEvents(wf: Workflow): WfEvent[] {
  // Start: „gilt ab", sonst das Anlagedatum der Regel – nie rückwirkend davor.
  const start = wf.config.validFrom ?? wf.createdAt?.slice(0, 10) ?? todayIso();
  const occ = lastDueOccurrence(wf.config, start);
  if (!occ) return [];

  const human = fmtDay(occ);
  return [
    {
      ref: `wiederkehrend-${occ}`,
      supplier: "",
      amount: 0,
      eventDate: occ,
      fill: (tpl) => tpl.replace(/\{datum\}/g, human).replace(/\{termin\}/g, human),
    },
  ];
}

async function collectEvents(triggerKey: string): Promise<WfEvent[]> {
  if (triggerKey === "new_beleg") {
    const now = new Date();
    const from = new Date(now.getTime() - 120 * 24 * 3600 * 1000).toISOString();
    const to = `${now.getUTCFullYear() + 1}-12-31T23:59:59Z`;
    const receipts = (await getReceiptsInRange(from, to)).filter((r) => r.type === "output");
    return receipts.map((r) => {
      const supplier = getCustomerName(r);
      const proj = getReceiptProjects(r)[0] ?? null;
      return {
        ref: r.id,
        supplier,
        amount: r.value || 0,
        hasDoc: !!r.fileUpload?.src,
        eventDate: r.receiptDate ? r.receiptDate.slice(0, 10) : null,
        fill: (tpl: string) => fillBeleg(tpl, r, supplier),
        review: {
          heroId: r.id,
          number: r.number,
          supplier,
          gross: r.value || 0,
          docUrl: r.fileUpload?.src ? getDocumentUrl(r.fileUpload.src) : null,
          projectMatchId: proj?.id ?? null,
          projectRelativeId: proj?.relativeId ?? null,
          projectName: proj?.name ?? null,
        },
      };
    });
  }

  if (triggerKey === "new_manual_beleg") {
    // Im Sammel-Posteingang automatisch erfasste Belege (source='inbox').
    const [receipts, dupKeys] = await Promise.all([
      listInboxReceipts(),
      getManualDuplicateKeys().catch(() => new Set<string>()),
    ]);
    return receipts.map((r) => {
      const supplier = r.supplier ?? "";
      const nr = `#${r.id}`;
      // Duplikat, wenn Lieferant+Betrag+Datum mehrfach unter den manuellen Belegen vorkommt.
      const dupKey = receiptDupKey(supplier, r.gross || 0, r.date);
      const isDuplicate = dupKey != null && dupKeys.has(dupKey);
      const note = [
        `Erfasster Beleg ${nr}`,
        supplier ? `Lieferant: ${supplier}` : null,
        `Betrag: ${euro.format(r.gross || 0)}`,
        r.date ? `Belegdatum: ${fmtDay(r.date)}` : null,
        r.description ? `Beschreibung: ${r.description}` : null,
        // Marker (werden in der Aufgabe ausgeblendet).
        isDuplicate ? "[DUPLIKAT]" : null,
        `[BELEGPRUEF:${r.id}]`,
      ]
        .filter(Boolean)
        .join("\n");
      return {
        ref: `manual-${r.id}`,
        supplier,
        amount: r.gross || 0,
        // Erfassungszeitpunkt (nicht Belegdatum) – für „gilt ab Regel-Anlage".
        eventDate: r.created ? r.created.slice(0, 10) : null,
        note,
        fill: (tpl: string) =>
          tpl
            .replace(/\{nr\}/g, nr)
            .replace(/\{lieferant\}/g, supplier)
            .replace(/\{betrag\}/g, euro.format(r.gross || 0))
            .replace(/\{datum\}/g, r.date ?? ""),
      };
    });
  }

  if (triggerKey === "lager_min_erreicht") {
    // Artikel, deren lokaler Bestand das gesetzte Minimum erreicht/unterschritten hat.
    const { below } = await getLagerMinStatus();
    const today = new Date().toISOString().slice(0, 10);
    return below.map((a) => {
      const bestand = `${a.quantity} ${a.unit}`.trim();
      const minTxt = `${a.min} ${a.unit}`.trim();
      const note = [
        `Artikel: ${a.name}`,
        a.sku ? `Artikel-Nr.: ${a.sku}` : null,
        `Bestand: ${bestand}`,
        `Minimum: ${minTxt}`,
      ]
        .filter(Boolean)
        .join("\n");
      return {
        ref: `lagermin-${a.heroArticleId}`,
        supplier: a.name, // erlaubt optional den „Lieferant/Name enthält"-Filter
        amount: a.quantity,
        eventDate: today,
        note,
        fill: (tpl: string) =>
          tpl
            .replace(/\{artikel\}/g, a.name)
            .replace(/\{nr\}/g, a.sku ?? "")
            .replace(/\{bestand\}/g, bestand)
            .replace(/\{min\}/g, String(a.min))
            .replace(/\{einheit\}/g, a.unit),
      };
    });
  }

  if (triggerKey === "angebot_alt_ohne_ab") {
    // Projekte in der Pipeline-Phase „Angebot offen" (offenes Angebot, noch kein AB).
    const pipe = await getProjectPipeline();
    const stages = pipe.stages.filter(
      (s) => /angebot/i.test(s.label) && /offen/i.test(s.label)
    );
    const now = Date.now();
    const events: WfEvent[] = [];
    for (const st of stages) {
      for (const p of st.projects) {
        if (!p.offerDate) continue; // ohne Versanddatum kein Alter bestimmbar
        const ageDays = Math.floor((now - new Date(p.offerDate).getTime()) / 86_400_000);
        if (ageDays < 0) continue;
        events.push({
          ref: `proj-${p.id}`,
          supplier: p.customerName ?? "",
          amount: p.offerSum || 0,
          ageDays,
          eventDate: p.offerDate ? p.offerDate.slice(0, 10) : null,
          fill: (tpl: string) => fillAngebot(tpl, p, ageDays),
        });
      }
    }
    return events;
  }

  if (triggerKey === "endrechnung") {
    // Kundenrechnungen (Endrechnungen) – je Rechnung ein Ereignis.
    const invoices = await getCustomerInvoices();
    const events: WfEvent[] = [];
    for (const inv of invoices) {
      if (inv.documentTypeId !== RECHNUNG_DOCUMENT_TYPE_ID) continue; // keine Gutschrift/Storno
      if (!ENDRECHNUNG_STYLES.has(inv.invoiceStyle ?? "")) continue; // nur Endrechnung, nicht Teil-/Abschlagsrechnung
      const kunde = inv.customerName ?? "";
      const email = inv.customerEmail ?? "";
      // Projekt-Schlüssel: sperrt Zweitversand pro Projekt (bzw. Kunde, falls kein Projekt).
      const projectKey = inv.project ? `p${inv.project.id}` : `k:${kunde.toLowerCase().trim()}`;
      // Notiz für den Anrufer + Marker (Kunden-E-Mail + Projekt) für den „Bewertungslink senden"-Button.
      const note = [
        `Kunde: ${kunde || "—"}`,
        inv.project?.name ? `Projekt: ${inv.project.name}` : null,
        `Rechnung: ${inv.number}`,
        `E-Mail (Kundenstamm): ${email || "— keine hinterlegt —"}`,
        `[BEWERTUNG:${email}|${kunde}|${projectKey}]`,
      ]
        .filter(Boolean)
        .join("\n");
      events.push({
        ref: `re-${inv.id}`,
        supplier: kunde,
        amount: inv.net || inv.gross || 0,
        eventDate: inv.date ? inv.date.slice(0, 10) : null,
        note,
        fill: (tpl: string) => fillEndrechnung(tpl, inv),
      });
    }
    return events;
  }

  if (triggerKey === "stunden_ohne_abschlag") {
    // Projekte mit gebuchten Stunden, aber (noch) ohne Rechnung/Abschlagsrechnung.
    const [projects, hourDetails, invoice] = await Promise.all([
      getProjects(),
      getProjectHourDetails(),
      getInvoiceNetByProject(),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const events: WfEvent[] = [];
    for (const p of projects) {
      const det = hourDetails.get(p.id);
      if (!det || det.hours <= 0) continue; // keine Stunden gebucht
      if (invoice.has(p.id)) continue; // bereits eine Rechnung/Abschlag vorhanden
      const note = [
        `Projekt: ${p.name}${p.relativeId != null ? ` (#${p.relativeId})` : ""}`,
        `Gebuchte Stunden: ${hoursFmt.format(det.hours)} h`,
        `Erfasst von: ${employeesText(det) || "—"}`,
        `Zeitraum: ${zeitraumText(det) || "—"} (${det.entries} Buchungen)`,
      ].join("\n");
      events.push({
        ref: `projstd-${p.id}`,
        supplier: p.customerName ?? "",
        amount: det.hours, // Stunden (für Mindeststunden-Filter)
        eventDate: today,
        note,
        fill: (tpl: string) => fillStunden(tpl, p, det),
      });
    }
    return events;
  }

  if (triggerKey === "logbuch_abschluss") {
    // Logbuch-Einträge (manuelle Notizen) je Projekt → Kunde. Stichwort/Kunde
    // werden pro Regel in matchesFilters geprüft.
    const [entries, projects] = await Promise.all([getGlobalLogbookSystem(300), getProjects()]);
    const byId = new Map<number, ProjectSummary>(projects.map((p) => [p.id, p]));
    const events: WfEvent[] = [];
    for (const e of entries) {
      if (SYSTEM_TITLE_RE.test(e.title)) continue; // automatische System-Einträge überspringen
      if (e.projectId == null) continue;
      const proj = byId.get(e.projectId);
      const customerName = proj?.customerName ?? "";
      const relId = e.projectRelativeId ?? proj?.relativeId ?? null;
      const projName = e.projectName ?? proj?.name ?? "";
      const dateShort = e.date ? e.date.slice(0, 10) : "";
      events.push({
        ref: `log-${e.id}`,
        supplier: customerName,
        amount: 0,
        eventDate: dateShort || null,
        note: `${e.title ? e.title + "\n" : ""}${e.text}`.trim(),
        projectId: e.projectId,
        projectRelativeId: relId,
        projectName: projName,
        author: e.author,
        fill: (tpl: string) =>
          tpl
            .replace(/\{kunde\}/g, customerName || "—")
            .replace(/\{projekt\}/g, projName || "—")
            .replace(/\{nr\}/g, relId != null ? `#${relId}` : "")
            .replace(/\{datum\}/g, dateShort),
      });
    }
    return events;
  }

  return [];
}

/** Untergrenze für das Ereignis-Datum: „gilt ab" oder (bei Belegen) das Erstelldatum der Regel. */
function effectiveValidFrom(triggerKey: string, wf: Workflow): string | null {
  if (wf.config.validFrom) return wf.config.validFrom;
  // Beleg-/Rechnungs- und Wiederhol-Regeln ohne „gilt ab" gelten ab Anlage der Regel
  // (kein Altbestand-Schwall bzw. keine rückwirkenden Termine).
  if (
    (triggerKey === "new_beleg" ||
      triggerKey === "new_manual_beleg" ||
      triggerKey === "endrechnung" ||
      triggerKey === "logbuch_abschluss" ||
      triggerKey === "wiederkehrend") &&
    wf.createdAt
  )
    return wf.createdAt.slice(0, 10);
  return null;
}

function matchesFilters(triggerKey: string, ev: WfEvent, cfg: WorkflowConfig): boolean {
  if (cfg.filterSupplier && !ev.supplier.toLowerCase().includes(cfg.filterSupplier.toLowerCase())) return false;
  if (cfg.filterMinAmount != null && ev.amount < cfg.filterMinAmount) return false;
  if (cfg.excludeManual && triggerKey === "new_beleg" && ev.hasDoc === false) return false;
  if (triggerKey === "angebot_alt_ohne_ab") {
    const threshold = cfg.minAgeDays != null ? cfg.minAgeDays : 14;
    if ((ev.ageDays ?? 0) < threshold) return false;
  }
  if (triggerKey === "logbuch_abschluss") {
    // Stichwort (Default „baustelle fertig") muss im Eintrag stehen.
    const kw = (cfg.keyword ?? "Baustelle fertig").toLowerCase();
    if (!(ev.note ?? "").toLowerCase().includes(kw)) return false;
    // Kunden-Eingrenzung: leer = alle; sonst muss der Kunde passen.
    if (cfg.customerFilters.length > 0) {
      const sup = ev.supplier.toLowerCase();
      const hit = cfg.customerFilters.some((c) => {
        const cf = c.toLowerCase();
        return sup === cf || sup.includes(cf) || cf.includes(sup);
      });
      if (!hit) return false;
    }
  }
  return true;
}

/** Effektiver Bearbeiter: Split nach ausgeschlossenen Lieferanten. */
function effectiveAssignee(c: WorkflowConfig, supplier: string): number {
  const excluded =
    c.excludedSuppliers.length > 0 &&
    c.excludedSuppliers.some((s) => supplier.toLowerCase().includes(s.toLowerCase()));
  return excluded && c.excludedAssigneeId ? c.excludedAssigneeId : c.assigneeId;
}

/**
 * Prüfer für die Rechnungsprüfung: Split nach Buchungskonto. Ist das Konto des
 * Belegs einem Prüfer zugeordnet, geht die Prüfung an diesen; sonst an den
 * Standard-Prüfer (`assigneeId`).
 */
function reviewerForAccount(c: WorkflowConfig, account: string | null | undefined): number {
  const acc = (account ?? "").trim();
  if (acc) {
    const m = c.accountReviewers.find((r) => r.account === acc);
    if (m) return m.assigneeId;
  }
  return c.assigneeId;
}

/**
 * Verkettung Rechnungsbuchung → Rechnungsprüfung: Wird eine vom „Rechnungsbuchung"-
 * Workflow (Auslöser new_manual_beleg, chainReview aktiv) erzeugte Aufgabe auf
 * „erledigt" gesetzt, wird für denselben manuellen Beleg automatisch eine
 * Prüf-Aufgabe angelegt (Prüfer aus der aktiven Rechnungsprüfungs-Regel), inkl.
 * PDF-Vorschau/Bearbeiten (Marker [BELEGPRUEF:id]). Idempotent je Beleg.
 */
export async function startReviewChainForManualTask(task: {
  id: number;
  description: string | null;
}): Promise<void> {
  const m = task.description?.match(/\[BELEGPRUEF:(\d+)\]/);
  if (!m) return;
  const belegId = Number(m[1]);
  if (!Number.isFinite(belegId) || belegId <= 0) return;

  // Ist die Verkettung überhaupt aktiv (Rechnungsbuchung-Regel mit chainReview)?
  const sourceWfs = await listActiveWorkflows("new_manual_beleg");
  if (!sourceWfs.some((w) => w.config.chainReview)) return;

  // Ziel: die aktive Rechnungsprüfungs-Regel (Auslöser new_beleg, Aktion review).
  const reviewWfs = (await listActiveWorkflows("new_beleg")).filter(
    (w) => w.config.actionType === "review"
  );
  const reviewWf = reviewWfs[0] ?? null;
  if (!reviewWf) return; // Keine Rechnungsprüfungs-Regel → nichts zu starten.

  const beleg = await getManualReceipt(belegId).catch(() => null);
  // Vertrauliche Belege (Lohn o. Ä.) NIE in die Rechnungsprüfung geben.
  if (beleg?.confidential) return;
  const supplier = beleg?.supplier ?? "";
  // Split nach Buchungskonto → zuständiger Prüfer (sonst Standard-Prüfer).
  const assignee = reviewerForAccount(reviewWf.config, beleg?.accountNumber);
  if (!assignee) return;

  // Idempotenz: je Beleg nur einmal starten (an der Rechnungsprüfungs-Regel gemerkt).
  const ref = `chain-manual-${belegId}`;
  const seen = await getRuleSeen(reviewWf.id);
  if (seen.has(ref)) return;
  await markRuleSeen(reviewWf.id, [ref]);

  const nr = beleg?.invoiceNumber ? beleg.invoiceNumber : `#${belegId}`;
  const betrag = euro.format(beleg?.gross ?? 0);
  const datum = beleg?.date ?? "";
  const title = (
    reviewWf.config.title
      .replace(/\{nr\}/g, nr)
      .replace(/\{lieferant\}/g, supplier)
      .replace(/\{betrag\}/g, betrag)
      .replace(/\{datum\}/g, datum)
      .trim() || `Rechnung prüfen: ${nr}`
  ).slice(0, 255);

  const noteLines = [
    `Beleg ${nr}`,
    supplier ? `Lieferant: ${supplier}` : null,
    `Betrag: ${betrag}`,
    datum ? `Belegdatum: ${fmtDay(datum)}` : null,
    reviewWf.config.description?.trim() || null,
    `[BELEGPRUEF:${belegId}]`,
  ].filter(Boolean) as string[];

  const dueDate = new Date(Date.now() + (reviewWf.config.dueOffsetDays || 0) * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  await createTask({
    title,
    description: noteLines.join("\n"),
    createdBy: reviewWf.createdBy ?? assignee,
    assignedTo: [assignee],
    dueDate,
    actionButtons: reviewWf.config.buttons,
  });
  await notifyAssignee(assignee, title);
  await addWorkflowLog(reviewWf.id, ref, `Rechnungsprüfung (verkettet) gestartet: ${title} → Prüfer #${assignee}`);
}

/**
 * Führt die Aktion einer Regel für ein Ereignis aus (Aufgabe oder Rechnungsprüfung).
 * Gibt true zurück, wenn tatsächlich etwas erstellt wurde (false = übersprungen).
 */
async function executeRule(wf: Workflow, ev: WfEvent): Promise<boolean> {
  const c = wf.config;
  if (wf.triggerKey === "logbuch_abschluss") return executeLogbuchAbschluss(wf, ev);
  const assignee = effectiveAssignee(c, ev.supplier);
  if (c.actionType === "review" && ev.review) {
    // Bereits entschiedene Belege (freigegeben/abgelehnt) nicht erneut zur Prüfung stellen.
    const existing = await getReceiptReview(ev.review.heroId);
    if (existing && (existing.status === "freigegeben" || existing.status === "abgelehnt")) {
      return false;
    }
    const lbl = reviewLabel(ev.review);
    await assignReviewer(ev.review.heroId, assignee, {
      number: ev.review.number,
      supplier: ev.review.supplier,
      gross: ev.review.gross,
      docUrl: ev.review.docUrl,
      projectMatchId: ev.review.projectMatchId,
      projectRelativeId: ev.review.projectRelativeId,
      projectName: ev.review.projectName,
    });
    await createReviewTask(ev.review.heroId, lbl, wf.createdBy ?? assignee, assignee, c.description);
    await notifyAssignee(assignee, `Rechnung prüfen: ${lbl}`);
    await addWorkflowLog(wf.id, ev.ref, `Rechnungsprüfung gestartet: ${lbl} → Prüfer #${assignee}`);
    return true;
  } else {
    const title = (ev.fill(c.title).trim() || "Aufgabe").slice(0, 255);
    const dueDate = new Date(Date.now() + (c.dueOffsetDays || 0) * 24 * 3600 * 1000).toISOString().slice(0, 10);
    // Zusatzinfo (z.B. wer/wann Stunden erfasst hat) an die Beschreibung anhängen.
    const description = ev.note
      ? [ev.fill(c.description ?? ""), ev.note].filter((s) => s && s.trim()).join("\n\n")
      : c.description;
    await createTask({
      title,
      description,
      createdBy: wf.createdBy ?? assignee,
      assignedTo: [assignee],
      dueDate,
      actionButtons: c.buttons,
    });
    await notifyAssignee(assignee, title);
    await addWorkflowLog(wf.id, ev.ref, `Aufgabe erstellt: ${title} → #${assignee}`);
    return true;
  }
}

/** Aktion für „Baustelle fertig": HTML-E-Mail an Empfänger + Logbuch-Notiz + Aufgabe (Abschlussrechnung). */
async function executeLogbuchAbschluss(wf: Workflow, ev: WfEvent): Promise<boolean> {
  const c = wf.config;
  const appUrl = process.env.APP_URL?.replace(/\/$/, "") || "https://floortec.pascaloster.de";

  // 1) Empfänger: interne Nutzer + externe Adressen.
  const emails = new Set<string>();
  if (c.mailUserIds.length > 0) {
    const users = await getUsersForNotification(c.mailUserIds);
    for (const u of users) if (u.email) emails.add(u.email);
  }
  for (const e of c.mailExtraEmails) emails.add(e);

  const projectLabel =
    `${ev.projectRelativeId != null ? `#${ev.projectRelativeId} ` : ""}${ev.projectName ?? ""}`.trim() || "Projekt";
  const dateLabel = ev.eventDate ? ev.eventDate.split("-").reverse().join(".") : new Date().toLocaleDateString("de-DE");
  const mailData = {
    customerName: ev.supplier || null,
    projectLabel,
    logText: ev.note ?? "",
    author: ev.author ?? null,
    dateLabel,
    projectUrl: `${appUrl}/dashboard/projekte`,
    logoUrl: `${appUrl}/logo.png`,
  };
  const subject = `Baustelle fertig: ${ev.supplier ? ev.supplier + " – " : ""}${projectLabel}`;
  const html = buildBaustelleFertigEmailHtml(mailData);
  const text = buildBaustelleFertigEmailText(mailData);

  const sentTo: string[] = [];
  for (const to of emails) {
    if (await sendMail(to, subject, text, html)) sentTo.push(to);
  }

  // 2) Logbuch-Notiz (session-frei) – nur wenn projektbezogen und ≥1 Mail raus.
  //    Formulierung bewusst OHNE „Baustelle fertig", damit die Regel nicht rekursiv auslöst.
  if (ev.projectId && sentTo.length > 0) {
    const stamp = new Date().toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    await addProjectLogbookEntry(
      ev.projectId,
      `Abschluss-Benachrichtigung per E-Mail versendet am ${stamp} Uhr an: ${sentTo.join(", ")}`
    );
  }

  // 3) Aufgabe „Abschlussrechnung" an die Zuständigen.
  const assignees = c.taskUserIds.length > 0 ? c.taskUserIds : c.assigneeId ? [c.assigneeId] : [];
  if (assignees.length > 0) {
    const title = (ev.fill(c.title).trim() || "Abschlussrechnung erstellen").slice(0, 255);
    const dueDate = new Date(Date.now() + (c.dueOffsetDays || 0) * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const description =
      [ev.fill(c.description ?? ""), ev.note].filter((s) => s && s.trim()).join("\n\n") || null;
    try {
      await createTask({
        title,
        description,
        createdBy: wf.createdBy ?? assignees[0],
        assignedTo: assignees,
        dueDate,
        projectId: ev.projectId ?? null,
        projectRelativeId: ev.projectRelativeId ?? null,
        projectName: ev.projectName ?? null,
        actionButtons: c.buttons,
      });
      for (const a of assignees) await notifyAssignee(a, title);
    } catch {
      /* Aufgabe fehlgeschlagen – Mail/Notiz sind bereits raus */
    }
  }

  await addWorkflowLog(
    wf.id,
    ev.ref,
    `Baustelle fertig (${ev.supplier || "?"}) → E-Mail an ${sentTo.length}, Aufgabe an ${assignees.length}`
  );
  return sentTo.length > 0 || assignees.length > 0;
}

/** Benachrichtigt den Zugewiesenen (In-App + Push + E-Mail) über eine neue Aufgabe. */
async function notifyAssignee(assigneeId: number, title: string): Promise<void> {
  try {
    await createTaskNotification({ userId: assigneeId, taskId: null, kind: "assigned", message: `Neue Aufgabe: „${title}"`, byName: "Workflow" });
  } catch {
    /* ignore */
  }
  try {
    await sendPushToUsers([assigneeId], { title: "Neue Aufgabe", body: title, url: "/dashboard/aufgaben", tag: "task-new" });
  } catch {
    /* ignore */
  }
  try {
    const recips = await getUsersForNotification([assigneeId]);
    const appUrl = process.env.APP_URL?.replace(/\/$/, "");
    const link = appUrl ? `\n\nZur Aufgabe: ${appUrl}/dashboard/aufgaben` : "";
    await Promise.all(
      recips
        .filter((x) => x.email)
        .map((x) =>
          sendMail(
            x.email as string,
            `Neue Aufgabe: ${title}`,
            `Hallo ${x.name},\n\nEs wurde automatisch eine Aufgabe erstellt:\n\n${title}${link}\n\n— FLOORTEC Dashboard`
          )
        )
    );
  } catch {
    /* ignore */
  }
}

async function runTrigger(triggerKey: string, force = false): Promise<{ created: number; checked: number }> {
  const meta = await getWorkflowMeta(triggerKey);
  if (!force && meta.lastRun && Date.now() - meta.lastRun.getTime() < THROTTLE_MS) {
    return { created: 0, checked: 0 };
  }

  const workflows = await listActiveWorkflows(triggerKey);
  if (workflows.length === 0) return { created: 0, checked: 0 };

  await touchWorkflowLastRun(triggerKey); // sofort sperren

  // Lager-Minimum: Artikel, die wieder ÜBER dem Minimum sind, aus den Merkern
  // entfernen – so löst ein erneutes Unterschreiten wieder eine Aufgabe aus.
  if (triggerKey === "lager_min_erreicht") {
    try {
      const { okIds } = await getLagerMinStatus();
      if (okIds.length > 0) {
        const refs = okIds.map((id) => `lagermin-${id}`);
        for (const wf of workflows) await unmarkRuleSeen(wf.id, refs);
      }
    } catch {
      /* optional */
    }
  }

  // Wiederkehrende Aufgaben haben je Regel ihren eigenen Zeitplan – ihre Ereignisse
  // entstehen deshalb pro Regel, nicht einmal gemeinsam für den ganzen Auslöser.
  const isRecurring = triggerKey === "wiederkehrend";

  let events: WfEvent[] = [];
  if (!isRecurring) {
    try {
      events = await collectEvents(triggerKey);
    } catch {
      return { created: 0, checked: 0 };
    }
    if (events.length === 0) return { created: 0, checked: 0 };
  }

  let created = 0;
  let recurringChecked = 0;
  // Je Regel: Ereignisse ab dem „gilt ab"-Datum, die diese Regel noch nicht getaskt hat.
  for (const wf of workflows) {
    if (created >= MAX_PER_RUN) break;
    if (!wf.config.assigneeId) continue;
    const seen = await getRuleSeen(wf.id);
    const effFrom = effectiveValidFrom(triggerKey, wf);
    const ruleEvents = isRecurring ? recurringEvents(wf) : events;
    if (isRecurring) recurringChecked += ruleEvents.length;

    for (const ev of ruleEvents) {
      if (created >= MAX_PER_RUN) break;
      if (seen.has(ev.ref)) continue;
      if (effFrom && (!ev.eventDate || ev.eventDate < effFrom)) continue;
      if (!matchesFilters(triggerKey, ev, wf.config)) continue;

      try {
        const acted = await executeRule(wf, ev);
        await markRuleSeen(wf.id, [ev.ref]);
        seen.add(ev.ref);
        if (acted) created++;
      } catch (e) {
        await addWorkflowLog(wf.id, ev.ref, `Fehler: ${e instanceof Error ? e.message : "unbekannt"}`);
      }
    }
  }
  return { created, checked: isRecurring ? recurringChecked : events.length };
}

/**
 * Prüft alle Auslöser und löst aktive Regeln aus. force=true umgeht die Drossel.
 * Bei force-Läufen (Timer/„Jetzt prüfen") wird ein Historien-Eintrag geschrieben,
 * damit sichtbar ist, dass der Dienst gelaufen ist.
 */
export async function runWorkflowScan(
  force = false,
  source = "auto"
): Promise<{ created: number; checked: number }> {
  let created = 0;
  let checked = 0;
  let error: string | null = null;
  for (const t of WORKFLOW_TRIGGER_KEYS) {
    try {
      const r = await runTrigger(t, force);
      created += r.created;
      checked += r.checked;
    } catch (e) {
      error = e instanceof Error ? e.message : "unbekannter Fehler";
    }
  }
  if (force) {
    try {
      await addWorkflowRun({ source, checked, created, error });
    } catch {
      /* Historie ist best-effort */
    }
  }
  return { created, checked };
}
