"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername, listAdminUserIds } from "@/lib/users";
import {
  bookStockByArticle,
  listArticlesWithoutEk,
  setMaterialEkByArticle,
  setMaterialMinMaxByArticle,
} from "@/lib/materials";
import { createEkPriceRequest, completeEkPriceRequests } from "@/lib/tasks";
import { getAllowedModules } from "@/lib/role-store";

const PATH = "/dashboard/lager";

async function currentUserId(): Promise<number | null> {
  const session = await getSession();
  if (!session) return null;
  const user = await getUserByUsername(session.username);
  return user?.id ?? null;
}

/**
 * Creates admin tasks for any of the given out-booked articles that have no EK
 * price, so the price can be entered and the booking value backfilled.
 */
async function requestMissingEkPrices(heroArticleIds: number[], byUserId: number): Promise<void> {
  const missing = await listArticlesWithoutEk(heroArticleIds);
  if (missing.length === 0) return;
  const adminIds = await listAdminUserIds();
  if (adminIds.length === 0) return;
  for (const a of missing) {
    await createEkPriceRequest(a.heroArticleId, a.name, byUserId, adminIds);
  }
}

/** Schnelle Inline-Buchung für einen einzelnen HERO-Artikel. */
export async function bookStockAction(formData: FormData): Promise<void> {
  const userId = await currentUserId();
  if (userId == null) return;

  const heroArticleId = Number(formData.get("heroArticleId"));
  const name = String(formData.get("name") ?? "").trim();
  const sku = String(formData.get("sku") ?? "").trim() || null;
  const unit = String(formData.get("unit") ?? "").trim() || "Stk";
  const direction = String(formData.get("direction"));
  const amountRaw = String(formData.get("amount") ?? "").trim().replace(",", ".");
  const amount = Number(amountRaw);
  const comment = String(formData.get("comment") ?? "").trim() || null;

  if (!Number.isFinite(heroArticleId) || heroArticleId <= 0) return;
  if (!Number.isFinite(amount) || amount <= 0) return;
  if (direction !== "in" && direction !== "out") return;

  const delta = direction === "in" ? amount : -amount;
  await bookStockByArticle({ heroArticleId, name, sku, unit }, delta, {
    comment,
    userId,
    direction,
  });
  if (direction === "out") await requestMissingEkPrices([heroArticleId], userId);
  revalidatePath(PATH);
}

export interface BookingItem {
  heroArticleId: number;
  name: string;
  itemNumber: string;
  unit: string;
  qty: number;
}

export interface BookingInput {
  direction: "in" | "out";
  project: { relativeId: number | null; name: string } | null;
  employeeName: string;
  items: BookingItem[];
}

export interface BookingResult {
  ok: boolean;
  error?: string;
}

/** Scan-Buchung: bucht alle Positionen auf ein Projekt (Ein-/Ausbuchung). */
export async function submitBooking(input: BookingInput): Promise<BookingResult> {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, error: "Nicht angemeldet." };

  if (input.direction !== "in" && input.direction !== "out") {
    return { ok: false, error: "Bitte Ein- oder Ausbuchung wählen." };
  }
  const employeeName = input.employeeName.trim();
  if (!employeeName) return { ok: false, error: "Bitte den Namen eintragen." };
  const items = (input.items ?? []).filter(
    (it) => Number.isFinite(it.heroArticleId) && it.qty > 0
  );
  if (items.length === 0) return { ok: false, error: "Keine Artikel erfasst." };

  const sign = input.direction === "in" ? 1 : -1;
  try {
    for (const it of items) {
      await bookStockByArticle(
        { heroArticleId: it.heroArticleId, name: it.name, sku: it.itemNumber || null, unit: it.unit },
        sign * it.qty,
        {
          comment: null,
          userId,
          projectRelativeId: input.project?.relativeId ?? null,
          projectName: input.project?.name ?? null,
          employeeName,
          direction: input.direction,
        }
      );
    }
  } catch {
    return { ok: false, error: "Buchung fehlgeschlagen." };
  }

  if (input.direction === "out") {
    try {
      await requestMissingEkPrices(
        items.map((it) => it.heroArticleId),
        userId
      );
    } catch {
      // Aufgaben-Erstellung ist optional – Buchung war erfolgreich.
    }
  }

  revalidatePath(PATH);
  return { ok: true };
}

/** Admin: setzt den EK-Preis eines Artikels und schließt offene Preis-Aufgaben. */
export async function setMaterialEkAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const user = await getUserByUsername(session.username);
  if (!user) return;
  const allowed = await getAllowedModules(user.role);
  if (!allowed.includes("lager_ek")) return;

  const heroArticleId = Number(formData.get("heroArticleId"));
  const priceRaw = String(formData.get("price") ?? "").trim().replace(",", ".");
  const price = Number(priceRaw);
  if (!Number.isFinite(heroArticleId) || heroArticleId <= 0) return;
  if (!Number.isFinite(price) || price < 0) return;

  await setMaterialEkByArticle(heroArticleId, price);
  if (price > 0) await completeEkPriceRequests(heroArticleId, user.id);
  revalidatePath(PATH);
}

/** Setzt Lager-Minimum/-Maximum eines Artikels (leeres Feld = kein Wert). */
export async function setMaterialMinMaxAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const user = await getUserByUsername(session.username);
  if (!user) return;
  const allowed = await getAllowedModules(user.role);
  if (!allowed.includes("lager")) return;

  const heroArticleId = Number(formData.get("heroArticleId"));
  const name = String(formData.get("name") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim() || "Stk";
  if (!Number.isFinite(heroArticleId) || heroArticleId <= 0) return;

  const parse = (v: FormDataEntryValue | null): number | null => {
    const s = String(v ?? "").trim().replace(",", ".");
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const min = parse(formData.get("min"));
  const max = parse(formData.get("max"));

  await setMaterialMinMaxByArticle({ heroArticleId, name, unit }, min, max);
  revalidatePath(PATH);
}
