"use server";

import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { saveUserNote } from "@/lib/user-notes";

export interface SaveNoteResult {
  ok: boolean;
  error?: string;
}

/** Speichert den Notizblock des aktuell angemeldeten Benutzers (privat). */
export async function saveNoteAction(content: string): Promise<SaveNoteResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Nicht angemeldet." };
  const user = await getUserByUsername(session.username);
  if (!user) return { ok: false, error: "Kein Benutzer." };
  try {
    await saveUserNote(user.id, typeof content === "string" ? content : "");
  } catch {
    return { ok: false, error: "Speichern fehlgeschlagen." };
  }
  return { ok: true };
}
