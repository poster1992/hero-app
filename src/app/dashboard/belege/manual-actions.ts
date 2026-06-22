"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { createManualReceipt, setManualReceiptPaid } from "@/lib/manual-receipts";

const PATH = "/dashboard/belege";

export interface UploadBelegState {
  error?: string;
  success?: string;
}

export async function uploadBelegAction(
  _prev: UploadBelegState,
  formData: FormData
): Promise<UploadBelegState> {
  const session = await getSession();
  if (!session) return { error: "Nicht angemeldet." };
  const me = await getUserByUsername(session.username);

  const date = String(formData.get("date") ?? "").trim() || null;
  const supplier = String(formData.get("supplier") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const grossRaw = String(formData.get("gross") ?? "").trim().replace(",", ".");
  const gross = Number(grossRaw);
  const vatRateRaw = String(formData.get("vatRate") ?? "").trim().replace(",", ".");
  const vatRate = vatRateRaw ? Number(vatRateRaw) : null;
  const account = String(formData.get("account") ?? "").trim(); // "number|name"

  if (!Number.isFinite(gross) || gross <= 0) {
    return { error: "Bitte einen gültigen Betrag (brutto) angeben." };
  }
  if (vatRate != null && !Number.isFinite(vatRate)) {
    return { error: "MwSt-Satz muss eine Zahl sein." };
  }
  if (!account) return { error: "Bitte ein Konto auswählen." };

  const sep = account.indexOf("|");
  const accountNumber = sep >= 0 ? account.slice(0, sep) : account;
  const accountName = sep >= 0 ? account.slice(sep + 1) : "";

  const upload = formData.get("file");
  let file: { buffer: Buffer; originalName: string; mime: string } | null = null;
  if (upload && typeof upload === "object" && "arrayBuffer" in upload && upload.size > 0) {
    const f = upload as File;
    if (f.size > 15 * 1024 * 1024) return { error: "Datei zu groß (max. 15 MB)." };
    file = {
      buffer: Buffer.from(await f.arrayBuffer()),
      originalName: f.name,
      mime: f.type || "application/octet-stream",
    };
  }

  try {
    await createManualReceipt({
      date,
      supplier,
      description,
      gross,
      vatRate,
      accountNumber,
      accountName,
      file,
      uploadedBy: me?.id ?? null,
    });
  } catch {
    return { error: "Beleg konnte nicht gespeichert werden." };
  }

  revalidatePath(PATH);
  return { success: "Beleg gespeichert." };
}

/** Markiert einen manuellen Beleg als bezahlt/offen. */
export async function setBelegPaidAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const id = Number(formData.get("id"));
  const paid = String(formData.get("paid")) === "1";
  if (!Number.isFinite(id) || id <= 0) return;
  await setManualReceiptPaid(id, paid);
  revalidatePath(PATH);
}
