"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { addBaustellenBeleg, deleteBaustellenBeleg } from "@/lib/baustellen-belege";

/** Lädt einen Beleg zu einem Baustellen-Ordner hoch (FormData: baustelleId, file). */
export async function uploadBaustellenBelegAction(
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Nicht angemeldet." };

  const baustelleId = Number(formData.get("baustelleId"));
  if (!Number.isFinite(baustelleId) || baustelleId <= 0) return { ok: false, error: "Ungültiger Ordner." };

  const upload = formData.get("file");
  if (!upload || typeof upload !== "object" || !("arrayBuffer" in upload) || upload.size === 0) {
    return { ok: false, error: "Keine Datei gewählt." };
  }
  const f = upload as File;
  if (f.size > 25 * 1024 * 1024) return { ok: false, error: "Datei zu groß (max. 25 MB)." };

  let uid: number | null = null;
  try {
    uid = (await getUserByUsername(session.username))?.id ?? null;
  } catch {
    uid = null;
  }

  try {
    await addBaustellenBeleg(
      baustelleId,
      {
        buffer: Buffer.from(await f.arrayBuffer()),
        originalName: f.name,
        mime: f.type || "application/octet-stream",
      },
      uid
    );
    revalidatePath(`/dashboard/baustellen/${baustelleId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Beleg konnte nicht gespeichert werden." };
  }
}

/** Entfernt einen Beleg. */
export async function deleteBaustellenBelegAction(
  id: number,
  baustelleId: number
): Promise<{ ok: boolean }> {
  if (!(await getSession())) return { ok: false };
  if (!Number.isFinite(id) || id <= 0) return { ok: false };
  try {
    await deleteBaustellenBeleg(id);
    revalidatePath(`/dashboard/baustellen/${baustelleId}`);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
