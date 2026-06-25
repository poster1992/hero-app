"use server";

import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { setPaymentOverride, clearPaymentOverride } from "@/lib/receipt-payment-status";

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

  if (status === "hero") {
    await clearPaymentOverride(heroId);
    return;
  }
  if (status !== "bezahlt" && status !== "offen") return;

  let userId: number | null = null;
  try {
    const me = await getUserByUsername(session.username);
    userId = me?.id ?? null;
  } catch {
    // Name/ID optional – Status wird trotzdem gesetzt.
  }
  await setPaymentOverride(heroId, status, userId);
}
