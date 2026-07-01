"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { setSetting, GOOGLE_REVIEW_URL_KEY } from "@/lib/settings";

const PATH = "/dashboard/einstellungen";

export interface SettingsState {
  error?: string;
  success?: string;
}

export async function saveGoogleReviewUrlAction(
  _prev: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const session = await getSession();
  if (!session || session.role !== "administrator") return { error: "Kein Zugriff." };

  const raw = String(formData.get("googleReviewUrl") ?? "").trim();
  if (raw && !/^https?:\/\/\S+$/i.test(raw)) {
    return { error: "Bitte eine gültige URL (beginnend mit http:// oder https://) eingeben." };
  }
  try {
    await setSetting(GOOGLE_REVIEW_URL_KEY, raw || null);
  } catch {
    return { error: "Speichern fehlgeschlagen." };
  }
  revalidatePath(PATH);
  return { success: raw ? "Bewertungslink gespeichert." : "Bewertungslink entfernt." };
}
