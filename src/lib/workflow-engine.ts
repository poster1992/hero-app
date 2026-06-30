import "server-only";
import { getReceiptsInRange, type Receipt } from "./hero-api";
import { getCustomerName } from "./invoices";
import { createTask } from "./tasks";
import { sendPushToUsers } from "./push";
import { createTaskNotification } from "./task-notifications";
import { getUsersForNotification } from "./users";
import { sendMail } from "./mailer";
import {
  listActiveWorkflows,
  getWorkflowMeta,
  touchWorkflowLastRun,
  setWorkflowSeeded,
  getSeenRefs,
  markSeen,
  addWorkflowLog,
} from "./workflows";

const TRIGGER = "new_beleg";
const THROTTLE_MS = 5 * 60 * 1000;

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

function fillTemplate(tpl: string, r: Receipt, supplier: string): string {
  return tpl
    .replace(/\{nr\}/g, r.number || "")
    .replace(/\{lieferant\}/g, supplier || "")
    .replace(/\{betrag\}/g, euro.format(r.value || 0))
    .replace(/\{datum\}/g, r.receiptDate ? r.receiptDate.slice(0, 10) : "");
}

/** Benachrichtigt den Zugewiesenen (In-App + Push + E-Mail) über eine neue Aufgabe. */
async function notifyAssignee(assigneeId: number, title: string): Promise<void> {
  try {
    await createTaskNotification({
      userId: assigneeId,
      taskId: null,
      kind: "assigned",
      message: `Neue Aufgabe: „${title}"`,
      byName: "Workflow",
    });
  } catch {
    /* ignore */
  }
  try {
    await sendPushToUsers([assigneeId], {
      title: "Neue Aufgabe",
      body: title,
      url: "/dashboard/aufgaben",
      tag: "task-new",
    });
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

/**
 * Prüft (gedrosselt) auf neue Belege und löst die aktiven „Neuer Beleg"-Regeln aus.
 * Beim ersten Lauf wird der Altbestand nur als „gesehen" markiert (keine Aufgaben).
 */
export async function runWorkflowScan(): Promise<void> {
  const meta = await getWorkflowMeta(TRIGGER);
  if (meta.lastRun && Date.now() - meta.lastRun.getTime() < THROTTLE_MS) return;

  const workflows = await listActiveWorkflows(TRIGGER);
  if (workflows.length === 0) return;

  await touchWorkflowLastRun(TRIGGER); // sofort sperren (Mehrfachläufe vermeiden)

  let receipts: Receipt[];
  try {
    const now = new Date();
    const from = new Date(now.getTime() - 120 * 24 * 3600 * 1000).toISOString();
    const to = `${now.getUTCFullYear() + 1}-12-31T23:59:59Z`;
    receipts = (await getReceiptsInRange(from, to)).filter((r) => r.type === "output");
  } catch {
    return;
  }

  const seen = await getSeenRefs(TRIGGER);

  // Erster Lauf: Altbestand nur markieren, nicht auslösen.
  if (!meta.seeded) {
    await markSeen(TRIGGER, receipts.map((r) => r.id));
    await setWorkflowSeeded(TRIGGER);
    return;
  }

  const fresh = receipts.filter((r) => !seen.has(r.id));
  for (const r of fresh) {
    const supplier = getCustomerName(r);
    for (const wf of workflows) {
      const c = wf.config;
      if (!c.assigneeId) continue;
      if (c.filterSupplier && !supplier.toLowerCase().includes(c.filterSupplier.toLowerCase())) continue;
      if (c.filterMinAmount != null && (r.value || 0) < c.filterMinAmount) continue;

      const title = (fillTemplate(c.title, r, supplier).trim() || `Beleg prüfen: ${r.number}`).slice(0, 255);
      const dueDate = new Date(Date.now() + (c.dueOffsetDays || 0) * 24 * 3600 * 1000)
        .toISOString()
        .slice(0, 10);
      try {
        await createTask({
          title,
          description: c.description,
          createdBy: wf.createdBy ?? c.assigneeId,
          assignedTo: [c.assigneeId],
          dueDate,
        });
        await notifyAssignee(c.assigneeId, title);
        await addWorkflowLog(wf.id, r.id, `Aufgabe erstellt: ${title}`);
      } catch (e) {
        await addWorkflowLog(wf.id, r.id, `Fehler: ${e instanceof Error ? e.message : "unbekannt"}`);
      }
    }
    await markSeen(TRIGGER, [r.id]);
  }
}
