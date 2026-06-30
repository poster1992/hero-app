"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { createContract, deleteContract, listContracts, type SavedContract } from "@/lib/contracts";

const PATH = "/dashboard/arbeitsvertrag";

async function currentUserId(): Promise<number | null> {
  const session = await getSession();
  if (!session) return null;
  try {
    return (await getUserByUsername(session.username))?.id ?? null;
  } catch {
    return null;
  }
}

export interface SaveContractResult {
  ok: boolean;
  id?: number;
  error?: string;
}

/** Speichert einen ausgefüllten Vertrag (Feld-Snapshot). */
export async function saveContractAction(
  employeeName: string,
  data: Record<string, unknown>
): Promise<SaveContractResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Nicht angemeldet." };
  const uid = await currentUserId();
  try {
    const id = await createContract({
      employeeName: (employeeName || "").trim() || "Unbenannt",
      data,
      createdBy: uid,
    });
    revalidatePath(PATH);
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Speichern fehlgeschlagen." };
  }
}

export async function deleteContractAction(id: number): Promise<{ ok: boolean }> {
  const session = await getSession();
  if (!session) return { ok: false };
  if (!Number.isFinite(id) || id <= 0) return { ok: false };
  try {
    await deleteContract(id);
    revalidatePath(PATH);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function loadContractsAction(): Promise<SavedContract[]> {
  if (!(await getSession())) return [];
  try {
    return await listContracts();
  } catch {
    return [];
  }
}
