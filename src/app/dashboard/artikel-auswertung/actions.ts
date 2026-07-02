"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { applyMerge, removeMerge } from "@/lib/article-merges";

const PATH = "/dashboard/artikel-auswertung";

export interface MergeResult {
  ok: boolean;
  error?: string;
}

/** Führt mehrere Artikel unter der gewählten Bezeichnung zusammen. */
export async function mergeArticlesAction(
  sources: string[],
  targetKey: string,
  targetLabel: string
): Promise<MergeResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Nicht angemeldet." };
  if (!targetKey || !Array.isArray(sources) || sources.length === 0) {
    return { ok: false, error: "Bitte mindestens zwei Artikel wählen." };
  }
  let uid: number | null = null;
  try {
    uid = (await getUserByUsername(session.username))?.id ?? null;
  } catch {
    uid = null;
  }
  try {
    await applyMerge(sources, targetKey, (targetLabel || "Zusammengeführt").slice(0, 255), uid);
  } catch {
    return { ok: false, error: "Zusammenführen fehlgeschlagen." };
  }
  revalidatePath(PATH);
  return { ok: true };
}

/** Löst eine Zusammenführung wieder auf. */
export async function unmergeArticlesAction(targetKey: string): Promise<MergeResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Nicht angemeldet." };
  if (!targetKey) return { ok: false, error: "Kein Artikel." };
  try {
    await removeMerge(targetKey);
  } catch {
    return { ok: false, error: "Auflösen fehlgeschlagen." };
  }
  revalidatePath(PATH);
  return { ok: true };
}
