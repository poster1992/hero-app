import "server-only";
import { getReceiptsInRange, getProjectPipeline, type Receipt } from "./hero-api";
import { getCustomerName, getDocumentUrl } from "./invoices";
import { createTask, createReviewTask } from "./tasks";
import { assignReviewer } from "./receipt-reviews";
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
  WORKFLOW_TRIGGER_KEYS,
  type Workflow,
  type WorkflowConfig,
} from "./workflows";

const THROTTLE_MS = 5 * 60 * 1000;
const MAX_PER_RUN = 25; // Schutz vor Flut beim ersten Lauf

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

/** Ein Auslöser-Ereignis (z.B. ein neuer Beleg oder ein zu altes Angebot). */
interface WfEvent {
  ref: string;
  supplier: string; // für filterSupplier (Lieferant/Kunde)
  amount: number; // für filterMinAmount
  ageDays?: number; // für Altersfilter
  eventDate?: string | null; // YYYY-MM-DD (Beleg- bzw. Angebotsdatum), für „gilt ab"
  fill: (tpl: string) => string; // Titel-Vorlage füllen
  /** Beleg-Daten für die Aktion „Rechnungsprüfung" (nur new_beleg). */
  review?: { heroId: string; number: string; supplier: string; gross: number; docUrl: string | null };
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

async function collectEvents(triggerKey: string): Promise<WfEvent[]> {
  if (triggerKey === "new_beleg") {
    const now = new Date();
    const from = new Date(now.getTime() - 120 * 24 * 3600 * 1000).toISOString();
    const to = `${now.getUTCFullYear() + 1}-12-31T23:59:59Z`;
    const receipts = (await getReceiptsInRange(from, to)).filter((r) => r.type === "output");
    return receipts.map((r) => {
      const supplier = getCustomerName(r);
      return {
        ref: r.id,
        supplier,
        amount: r.value || 0,
        eventDate: r.receiptDate ? r.receiptDate.slice(0, 10) : null,
        fill: (tpl: string) => fillBeleg(tpl, r, supplier),
        review: {
          heroId: r.id,
          number: r.number,
          supplier,
          gross: r.value || 0,
          docUrl: r.fileUpload?.src ? getDocumentUrl(r.fileUpload.src) : null,
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

  return [];
}

/** Untergrenze für das Ereignis-Datum: „gilt ab" oder (bei Belegen) das Erstelldatum der Regel. */
function effectiveValidFrom(triggerKey: string, wf: Workflow): string | null {
  if (wf.config.validFrom) return wf.config.validFrom;
  // Beleg-Regeln ohne „gilt ab" gelten ab Anlage der Regel (kein Altbestand-Schwall).
  if (triggerKey === "new_beleg" && wf.createdAt) return wf.createdAt.slice(0, 10);
  return null;
}

function matchesFilters(triggerKey: string, ev: WfEvent, cfg: WorkflowConfig): boolean {
  if (cfg.filterSupplier && !ev.supplier.toLowerCase().includes(cfg.filterSupplier.toLowerCase())) return false;
  if (cfg.filterMinAmount != null && ev.amount < cfg.filterMinAmount) return false;
  if (triggerKey === "angebot_alt_ohne_ab") {
    const threshold = cfg.minAgeDays != null ? cfg.minAgeDays : 14;
    if ((ev.ageDays ?? 0) < threshold) return false;
  }
  return true;
}

/** Führt die Aktion einer Regel für ein Ereignis aus (Aufgabe oder Rechnungsprüfung). */
async function executeRule(wf: Workflow, ev: WfEvent): Promise<void> {
  const c = wf.config;
  if (c.actionType === "review" && ev.review) {
    const lbl = reviewLabel(ev.review);
    await assignReviewer(ev.review.heroId, c.assigneeId, {
      number: ev.review.number,
      supplier: ev.review.supplier,
      gross: ev.review.gross,
      docUrl: ev.review.docUrl,
    });
    await createReviewTask(ev.review.heroId, lbl, wf.createdBy ?? c.assigneeId, c.assigneeId, c.description);
    await notifyAssignee(c.assigneeId, `Rechnung prüfen: ${lbl}`);
    await addWorkflowLog(wf.id, ev.ref, `Rechnungsprüfung gestartet: ${lbl}`);
  } else {
    const title = (ev.fill(c.title).trim() || "Aufgabe").slice(0, 255);
    const dueDate = new Date(Date.now() + (c.dueOffsetDays || 0) * 24 * 3600 * 1000).toISOString().slice(0, 10);
    await createTask({
      title,
      description: c.description,
      createdBy: wf.createdBy ?? c.assigneeId,
      assignedTo: [c.assigneeId],
      dueDate,
      actionButtons: c.buttons,
    });
    await notifyAssignee(c.assigneeId, title);
    await addWorkflowLog(wf.id, ev.ref, `Aufgabe erstellt: ${title}`);
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

async function runTrigger(triggerKey: string): Promise<void> {
  const meta = await getWorkflowMeta(triggerKey);
  if (meta.lastRun && Date.now() - meta.lastRun.getTime() < THROTTLE_MS) return;

  const workflows = await listActiveWorkflows(triggerKey);
  if (workflows.length === 0) return;

  await touchWorkflowLastRun(triggerKey); // sofort sperren

  let events: WfEvent[];
  try {
    events = await collectEvents(triggerKey);
  } catch {
    return;
  }
  if (events.length === 0) return;

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
        await executeRule(wf, ev);
        await markRuleSeen(wf.id, [ev.ref]);
        seen.add(ev.ref);
        created++;
      } catch (e) {
        await addWorkflowLog(wf.id, ev.ref, `Fehler: ${e instanceof Error ? e.message : "unbekannt"}`);
      }
    }
  }
}

/** Prüft (gedrosselt) alle Auslöser und löst aktive Regeln aus. */
export async function runWorkflowScan(): Promise<void> {
  for (const t of WORKFLOW_TRIGGER_KEYS) {
    try {
      await runTrigger(t);
    } catch {
      /* nächster Trigger */
    }
  }
}
