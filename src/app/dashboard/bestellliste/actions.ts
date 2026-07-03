"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import {
  addToOrderList,
  addManualOrderItem,
  updateOrderItem,
  removeOrderItem,
  clearDoneOrderItems,
  type OrderInput,
} from "@/lib/order-list";

const PATH = "/dashboard/bestellliste";

export interface OrderActionResult {
  ok: boolean;
  added?: number;
  error?: string;
}

/** Fügt ausgewählte Artikel (mit Lieferant/Preis) zur Bestellliste hinzu. */
export async function addToOrderListAction(items: OrderInput[]): Promise<OrderActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Nicht angemeldet." };
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: "Nichts ausgewählt." };
  let uid: number | null = null;
  try {
    uid = (await getUserByUsername(session.username))?.id ?? null;
  } catch {
    uid = null;
  }
  try {
    const added = await addToOrderList(items, uid);
    revalidatePath(PATH);
    return { ok: true, added };
  } catch {
    return { ok: false, error: "Hinzufügen fehlgeschlagen." };
  }
}

/** Manuell erfasster Artikel (mit optionalem Internet-Link). */
export async function addManualOrderItemAction(input: {
  articleLabel: string;
  supplier?: string | null;
  unitPrice?: number | null;
  unit?: string | null;
  quantity?: number | null;
  link?: string | null;
  note?: string | null;
}): Promise<OrderActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Nicht angemeldet." };
  if (!input.articleLabel?.trim()) return { ok: false, error: "Bitte einen Artikelnamen angeben." };
  const link = (input.link ?? "").trim();
  if (link && !/^https?:\/\/\S+/i.test(link)) return { ok: false, error: "Link muss mit http:// oder https:// beginnen." };
  let uid: number | null = null;
  try {
    uid = (await getUserByUsername(session.username))?.id ?? null;
  } catch {
    uid = null;
  }
  try {
    await addManualOrderItem(
      {
        articleLabel: input.articleLabel,
        supplier: input.supplier?.trim() || null,
        unitPrice: input.unitPrice ?? null,
        unit: input.unit?.trim() || null,
        quantity: input.quantity ?? null,
        link: link || null,
        note: input.note?.trim() || null,
      },
      uid
    );
    revalidatePath(PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Hinzufügen fehlgeschlagen." };
  }
}

export async function updateOrderItemAction(
  id: number,
  patch: { quantity?: number | null; done?: boolean; note?: string | null; link?: string | null }
): Promise<{ ok: boolean }> {
  if (!(await getSession())) return { ok: false };
  if (!Number.isFinite(id) || id <= 0) return { ok: false };
  try {
    await updateOrderItem(id, patch);
    revalidatePath(PATH);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function removeOrderItemAction(id: number): Promise<{ ok: boolean }> {
  if (!(await getSession())) return { ok: false };
  try {
    await removeOrderItem(id);
    revalidatePath(PATH);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function clearDoneOrderAction(): Promise<{ ok: boolean }> {
  if (!(await getSession())) return { ok: false };
  try {
    await clearDoneOrderItems();
    revalidatePath(PATH);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
