"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { createPaymentAdvice, deletePaymentAdvice } from "@/lib/payment-advices";

const PATH = "/dashboard/belege";

export interface UploadAvisState {
  error?: string;
  success?: string;
}

/** Lädt ein Zahlungsavis (Datei) für einen Monat hoch – reine Speicherung. */
export async function uploadAvisAction(
  _prev: UploadAvisState,
  formData: FormData
): Promise<UploadAvisState> {
  const session = await getSession();
  if (!session) return { error: "Nicht angemeldet." };
  const me = await getUserByUsername(session.username);

  const year = Number(formData.get("year"));
  const month = Number(formData.get("month"));
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return { error: "Ungültiger Zeitraum." };
  }
  // Reine Ablage – Lieferant/Notiz werden bewusst nicht mehr erfasst.
  const supplier = null;
  const note = null;

  const upload = formData.get("file");
  if (!upload || typeof upload !== "object" || !("arrayBuffer" in upload) || (upload as File).size === 0) {
    return { error: "Bitte eine Datei auswählen." };
  }
  const f = upload as File;
  if (f.size > 15 * 1024 * 1024) return { error: "Datei zu groß (max. 15 MB)." };

  try {
    await createPaymentAdvice({
      year: Math.trunc(year),
      month: Math.trunc(month),
      supplier,
      note,
      file: {
        buffer: Buffer.from(await f.arrayBuffer()),
        originalName: f.name,
        mime: f.type || "application/octet-stream",
      },
      uploadedBy: me?.id ?? null,
    });
  } catch {
    return { error: "Avis konnte nicht gespeichert werden." };
  }

  revalidatePath(PATH);
  return { success: "Zahlungsavis gespeichert." };
}

/** Löscht ein Zahlungsavis (inkl. Datei). */
export async function deleteAvisAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) return;
  await deletePaymentAdvice(id);
  revalidatePath(PATH);
}
