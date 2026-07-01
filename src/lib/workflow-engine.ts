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
import { createTask, createReviewTask } from "./tasks";
import { assignReviewer, getReceiptReview } from "./receipt-reviews";
import { sendPushToUsers } from "./push";
import { createTaskNotification } from "./task-notifications";
import { getUsersForNotification } from "./users";
import { sendMail } from "./mailer";
import {
  listActiveWorkflows,
  getWorkflowMeta,
  touchWorkflowLastRun,
  getRuleSeen,
  markRuleSeen,
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
      events.push({
        ref: `re-${inv.id}`,
        supplier: inv.customerName ?? "",
        amount: inv.net || inv.gross || 0,
        eventDate: inv.date ? inv.date.slice(0, 10) : null,
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

  return [];
}

/** Untergrenze für das Ereignis-Datum: „gilt ab" oder (bei Belegen) das Erstelldatum der Regel. */
function effectiveValidFrom(triggerKey: string, wf: Workflow): string | null {
  if (wf.config.validFrom) return wf.config.validFrom;
  // Beleg-/Rechnungs-Regeln ohne „gilt ab" gelten ab Anlage der Regel (kein Altbestand-Schwall).
  if ((triggerKey === "new_beleg" || triggerKey === "endrechnung") && wf.createdAt) return wf.createdAt.slice(0, 10);
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
 * Führt die Aktion einer Regel für ein Ereignis aus (Aufgabe oder Rechnungsprüfung).
 * Gibt true zurück, wenn tatsächlich etwas erstellt wurde (false = übersprungen).
 */
async function executeRule(wf: Workflow, ev: WfEvent): Promise<boolean> {
  const c = wf.config;
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

  let events: WfEvent[];
  try {
    events = await collectEvents(triggerKey);
  } catch {
    return { created: 0, checked: 0 };
  }
  if (events.length === 0) return { created: 0, checked: 0 };

  let created = 0;
  // Je Regel: Ereignisse ab dem „gilt ab"-Datum, die diese Regel noch nicht getaskt hat.
  for (const wf of workflows) {
    if (created >= MAX_PER_RUN) break;
    if (!wf.config.assigneeId) continue;
    const seen = await getRuleSeen(wf.id);
    const effFrom = effectiveValidFrom(triggerKey, wf);

    for (const ev of events) {
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
  return { created, checked: events.length };
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
