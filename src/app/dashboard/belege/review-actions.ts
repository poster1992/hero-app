"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername, getUsersForNotification } from "@/lib/users";
import { getAllowedModules } from "@/lib/role-store";
import {
  assignReviewer,
  setReviewDecision,
  getReceiptReview,
  addReviewHistory,
  type ReviewStatus,
} from "@/lib/receipt-reviews";
import { createReviewTask, completeReviewTasks } from "@/lib/tasks";

const PATH = "/dashboard/belege";
const TASKS_PATH = "/dashboard/aufgaben";

async function authorizedUser() {
  const session = await getSession();
  if (!session) return null;
  const user = await getUserByUsername(session.username);
  if (!user) return null;
  const allowed = await getAllowedModules(user.role);
  if (!allowed.includes("rechnungspruefung")) return null;
  return user;
}

function snapshot(formData: FormData) {
  const number = String(formData.get("number") ?? "").trim() || null;
  const supplier = String(formData.get("supplier") ?? "").trim() || null;
  const grossRaw = String(formData.get("gross") ?? "").trim();
  const gross = grossRaw ? Number(grossRaw) : null;
  const docUrl = String(formData.get("docUrl") ?? "").trim() || null;
  return { number, supplier, gross: Number.isFinite(gross as number) ? gross : null, docUrl };
}

function label(snap: { number: string | null; supplier: string | null; gross: number | null }) {
  const parts = [snap.number, snap.supplier].filter(Boolean);
  const base = parts.join(" · ") || "Beleg";
  return snap.gross != null
    ? `${base} · ${snap.gross.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}`
    : base;
}

/** Weist einen Beleg einem Prüfer zu und legt eine Aufgabe an. */
export async function assignReviewAction(formData: FormData): Promise<void> {
  const user = await authorizedUser();
  if (!user) return;
  const heroId = String(formData.get("heroId") ?? "").trim();
  const toUserId = Number(formData.get("toUserId"));
  if (!heroId || !Number.isFinite(toUserId) || toUserId <= 0) return;
  const note = String(formData.get("note") ?? "").trim() || null;
  const snap = snapshot(formData);
  await assignReviewer(heroId, toUserId, snap);
  await createReviewTask(heroId, label(snap), user.id, toUserId, note);
  const assignee = (await getUsersForNotification([toUserId]))[0];
  const assigneeName = assignee?.name ?? `#${toUserId}`;
  await addReviewHistory(heroId, user.id, "assigned", `An ${assigneeName}${note ? ` · ${note}` : ""}`);
  revalidatePath(PATH);
  revalidatePath(TASKS_PATH);
}

/**
 * Trägt die Prüfentscheidung ein (Freigeben/Ablehnen) und schließt die Aufgabe.
 * Erlaubt für Berechtigte ODER den zugewiesenen Prüfer (z. B. aus der Aufgabe).
 */
export async function decideReviewAction(
  formData: FormData
): Promise<{ openProjectId: number | null }> {
  const none = { openProjectId: null };
  const session = await getSession();
  if (!session) return none;
  const user = await getUserByUsername(session.username);
  if (!user) return none;
  const heroId = String(formData.get("heroId") ?? "").trim();
  const decision = String(formData.get("decision") ?? "") as ReviewStatus;
  if (!heroId || (decision !== "freigegeben" && decision !== "abgelehnt")) return none;

  const review = await getReceiptReview(heroId);
  const allowed = (await getAllowedModules(user.role)).includes("rechnungspruefung");
  if (!allowed && review?.assignedToId !== user.id) return none;

  const note = String(formData.get("note") ?? "").trim() || null;
  await setReviewDecision(heroId, decision, user.id, note, snapshot(formData));
  await addReviewHistory(heroId, user.id, decision, note);
  await completeReviewTasks(heroId, user.id);
  revalidatePath(PATH);
  revalidatePath(TASKS_PATH);

  // Nach Freigabe: Projekt-Popup öffnen, damit der Prüfer die Beleg-Artikel
  // den Soll-Artikeln zuordnet.
  return {
    openProjectId: decision === "freigegeben" ? review?.projectMatchId ?? null : null,
  };
}
