"use server";

import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { setPaymentOverride, clearPaymentOverride } from "@/lib/receipt-payment-status";
import { logReceiptEvent } from "@/lib/receipt-history";

/**
 * Setzt den lokalen Zahlstatus eines Belegs (überschreibt den HERO-Status) bzw.
 * entfernt ihn wieder (status = "hero" → wieder HERO-Status).
 */
export async function setReceiptPaymentStatusAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const heroId = String(formData.get("heroId") ?? "").trim();
  const status = String(formData.get("status") ?? "");
  if (!heroId) return;

  let userId: number | null = null;
  try {
    const me = await getUserByUsername(session.username);
    userId = me?.id ?? null;
  } catch {
    // Name/ID optional – Status wird trotzdem gesetzt.
  }

  if (status === "hero") {
    await clearPaymentOverride(heroId);
    await logReceiptEvent({
      kind: "hero",
      receiptId: heroId,
      action: "status",
      detail: "lokaler Zahlstatus entfernt – es gilt wieder der HERO-Status",
      userId,
    });
    return;
  }
  if (status !== "bezahlt" && status !== "offen") return;

  await setPaymentOverride(heroId, status, userId);
  await logReceiptEvent({
    kind: "hero",
    receiptId: heroId,
    action: "status",
    detail: `${status} (lokal gesetzt, überschreibt HERO)`,
    userId,
  });
}
