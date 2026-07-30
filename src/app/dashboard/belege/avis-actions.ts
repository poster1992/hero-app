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
  const files = formData
    .getAll("file")
    .filter((u): u is File => typeof u === "object" && u !== null && "arrayBuffer" in u && (u as File).size > 0);
  if (files.length === 0) return { error: "Bitte mindestens eine Datei auswählen." };
  if (files.some((f) => f.size > 15 * 1024 * 1024)) return { error: "Mindestens eine Datei ist zu groß (max. 15 MB)." };

  let saved = 0;
  try {
    for (const f of files) {
      await createPaymentAdvice({
        year: Math.trunc(year),
        month: Math.trunc(month),
        supplier: null,
        note: null,
        file: {
          buffer: Buffer.from(await f.arrayBuffer()),
          originalName: f.name,
          mime: f.type || "application/octet-stream",
        },
        uploadedBy: me?.id ?? null,
      });
      saved++;
    }
  } catch {
    if (saved === 0) return { error: "Avis konnte nicht gespeichert werden." };
  }

  revalidatePath(PATH);
  return { success: `${saved} ${saved === 1 ? "Zahlungsavis" : "Zahlungsavise"} gespeichert.` };
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
