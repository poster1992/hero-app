"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getAllowedModules } from "@/lib/role-store";
import { sendReviewMail } from "@/lib/review-mail";
import { createTaskAction } from "@/app/dashboard/aufgaben/actions";
import {
  wasReviewEmailSentToCustomer,
  markReviewEmailSent,
} from "@/lib/review-emails";

const PATH = "/dashboard/bewertungen";
const MODULE = "cockpit_bewertungen";

async function requireAccess() {
  const session = await getSession();
  if (!session) return null;
  const user = await getUserByUsername(session.username);
  if (!user) return null;
  const allowed = await getAllowedModules(user.role);
  if (!allowed.includes(MODULE)) return null;
  return user;
}

export interface SendReviewOutcome {
  ok: boolean;
  error?: string;
  /** true, wenn der Kunde bereits eine Bewertungsmail erhalten hat. */
  alreadySent?: boolean;
}

/** Sendet einem einzelnen Kunden die Google-Bewertungs-Mail (mit Doppelversand-Sperre pro Kunde). */
export async function sendReviewToCustomerAction(input: {
  customerId: number | string;
  name: string;
  email: string;
}): Promise<SendReviewOutcome> {
  const user = await requireAccess();
  if (!user) return { ok: false, error: "Keine Berechtigung." };

  const customerId = String(input.customerId ?? "").trim();
  const email = String(input.email ?? "").trim();
  const name = String(input.name ?? "").trim();
  if (!email) return { ok: false, error: "Kunde hat keine E-Mail-Adresse." };

  // Hat dieser Kunde jemals schon eine erhalten?
  if (await wasReviewEmailSentToCustomer({ customerId, email })) {
    return { ok: false, alreadySent: true, error: "Dieser Kunde hat bereits eine Bewertungsmail erhalten." };
  }

  const res = await sendReviewMail(email, name || null);
  if (!res.ok) return { ok: false, error: res.error };

  try {
    await markReviewEmailSent({
      projectKey: `c:${customerId || email.toLowerCase()}`,
      email,
      taskId: null,
      sentBy: user.id,
      customerId: customerId || null,
      customerName: name || null,
    });
  } catch {
    /* Protokoll ist best-effort – Mail ist raus. */
  }

  revalidatePath(PATH);
  return { ok: true };
}

export interface CreateReviewTaskOutcome {
  ok: boolean;
  error?: string;
}

/**
 * Legt aus der Kundenliste eine Aufgabe „Kundenzufriedenheit erfragen" an.
 * Die Aufgabe trägt den [BEWERTUNG:…]-Marker, sodass in der Aufgabe direkt der
 * „Bewertung senden"-Button erscheint (mit derselben Pro-Kunde-Sperre).
 */
export async function createReviewTaskAction(input: {
  customerId: number | string;
  name: string;
  email: string;
  assignedTo: number[];
  dueDate: string;
}): Promise<CreateReviewTaskOutcome> {
  const user = await requireAccess();
  if (!user) return { ok: false, error: "Keine Berechtigung." };

  const customerId = String(input.customerId ?? "").trim();
  const email = String(input.email ?? "").trim();
  const name = String(input.name ?? "").trim();
  const assignedTo = (input.assignedTo ?? []).filter((n) => Number.isFinite(n) && n > 0);
  const dueDate = String(input.dueDate ?? "").trim();

  if (assignedTo.length === 0) return { ok: false, error: "Bitte mindestens einen Mitarbeiter auswählen." };
  if (!dueDate) return { ok: false, error: "Bitte ein Fälligkeitsdatum angeben." };

  // Projekt-Schlüssel identisch zum Direktversand (Pro-Kunde-Sperre greift gemeinsam).
  const projectKey = `c:${customerId || email.toLowerCase()}`;
  const description =
    `Kunde: ${name || "—"}\n` +
    `E-Mail (Kundenstamm): ${email || "— keine hinterlegt —"}\n` +
    `Bitte den Kunden kontaktieren, nach der Zufriedenheit fragen und anschließend über den Button die ` +
    `Google-Bewertungs-Anfrage senden.\n` +
    `[BEWERTUNG:${email}|${name}|${projectKey}]`;

  const fd = new FormData();
  fd.set("title", `Kundenzufriedenheit erfragen: ${name || email}`);
  fd.set("description", description);
  for (const uid of assignedTo) fd.append("assignedTo", String(uid));
  fd.set("dueDate", dueDate);

  const res = await createTaskAction({}, fd);
  if (res.error) return { ok: false, error: res.error };

  revalidatePath(PATH);
  return { ok: true };
}

export interface BulkReviewResult {
  ok: boolean;
  error?: string;
  sent: number;
  skipped: number;
  failed: number;
  failedNames: string[];
}

/** Sendet an mehrere Kunden. Bereits versendete Kunden werden übersprungen. */
export async function sendReviewBulkAction(
  customers: { customerId: number | string; name: string; email: string }[]
): Promise<BulkReviewResult> {
  const user = await requireAccess();
  if (!user) return { ok: false, error: "Keine Berechtigung.", sent: 0, skipped: 0, failed: 0, failedNames: [] };

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const failedNames: string[] = [];

  for (const c of customers) {
    const customerId = String(c.customerId ?? "").trim();
    const email = String(c.email ?? "").trim();
    const name = String(c.name ?? "").trim();
    if (!email) {
      skipped++;
      continue;
    }
    if (await wasReviewEmailSentToCustomer({ customerId, email })) {
      skipped++;
      continue;
    }
    const res = await sendReviewMail(email, name || null);
    if (!res.ok) {
      failed++;
      failedNames.push(name || email);
      continue;
    }
    try {
      await markReviewEmailSent({
        projectKey: `c:${customerId || email.toLowerCase()}`,
        email,
        taskId: null,
        sentBy: user.id,
        customerId: customerId || null,
        customerName: name || null,
      });
    } catch {
      /* best-effort */
    }
    sent++;
  }

  revalidatePath(PATH);
  return { ok: true, sent, skipped, failed, failedNames };
}
