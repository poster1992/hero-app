"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getAllowedModules } from "@/lib/role-store";
import {
  createVehicle,
  updateVehicle,
  deleteVehicle,
  addVehicleDocument,
  updateVehicleDocumentLabel,
  deleteVehicleDocument,
  listVehicleDocuments,
  type VehicleDocument,
} from "@/lib/vehicles";

const PATH = "/dashboard/fahrzeuge";
const MODULE = "cockpit_fahrzeuge";
const MAX_SIZE = 25 * 1024 * 1024; // 25 MB

async function requireAccess() {
  const session = await getSession();
  if (!session) return null;
  const user = await getUserByUsername(session.username);
  if (!user) return null;
  const allowed = await getAllowedModules(user.role);
  if (!allowed.includes(MODULE)) return null;
  return user;
}

export interface VehicleActionState {
  error?: string;
  success?: string;
}

export async function createVehicleAction(
  _prev: VehicleActionState,
  formData: FormData
): Promise<VehicleActionState> {
  if (!(await requireAccess())) return { error: "Kein Zugriff." };
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Bitte einen Fahrzeugnamen angeben." };
  const plate = String(formData.get("plate") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;
  try {
    await createVehicle({ name, plate, note });
  } catch {
    return { error: "Fahrzeug konnte nicht angelegt werden." };
  }
  revalidatePath(PATH);
  return { success: `Fahrzeug „${name}" angelegt.` };
}

export async function updateVehicleAction(
  _prev: VehicleActionState,
  formData: FormData
): Promise<VehicleActionState> {
  if (!(await requireAccess())) return { error: "Kein Zugriff." };
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) return { error: "Ungültiges Fahrzeug." };
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Bitte einen Fahrzeugnamen angeben." };
  const plate = String(formData.get("plate") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;
  try {
    await updateVehicle({ id, name, plate, note });
  } catch {
    return { error: "Fahrzeug konnte nicht gespeichert werden." };
  }
  revalidatePath(PATH);
  return { success: "Fahrzeug gespeichert." };
}

export async function deleteVehicleAction(formData: FormData): Promise<void> {
  if (!(await requireAccess())) return;
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) return;
  await deleteVehicle(id);
  revalidatePath(PATH);
}

export interface UploadDocResult {
  ok: boolean;
  error?: string;
}

/** Lädt ein Dokument (PDF/Bild) hoch und ordnet es einem Fahrzeug zu. */
export async function uploadVehicleDocAction(formData: FormData): Promise<UploadDocResult> {
  const user = await requireAccess();
  if (!user) return { ok: false, error: "Kein Zugriff." };

  const vehicleId = Number(formData.get("vehicleId"));
  if (!Number.isFinite(vehicleId) || vehicleId <= 0) return { ok: false, error: "Ungültiges Fahrzeug." };
  const label = String(formData.get("label") ?? "").trim();

  const upload = formData.get("file");
  if (!upload || typeof upload !== "object" || !("arrayBuffer" in upload) || (upload as File).size === 0) {
    return { ok: false, error: "Bitte eine Datei auswählen." };
  }
  const f = upload as File;
  if (f.size > MAX_SIZE) return { ok: false, error: "Datei zu groß (max. 25 MB)." };

  try {
    await addVehicleDocument({
      vehicleId,
      label,
      file: {
        buffer: Buffer.from(await f.arrayBuffer()),
        originalName: f.name,
        mime: f.type || "application/octet-stream",
      },
      uploadedBy: user.id,
    });
  } catch {
    return { ok: false, error: "Dokument konnte nicht gespeichert werden." };
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function renameVehicleDocAction(id: number, label: string): Promise<UploadDocResult> {
  if (!(await requireAccess())) return { ok: false, error: "Kein Zugriff." };
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "Ungültiges Dokument." };
  if (!label.trim()) return { ok: false, error: "Bitte eine Beschriftung angeben." };
  try {
    await updateVehicleDocumentLabel(id, label);
  } catch {
    return { ok: false, error: "Beschriftung konnte nicht geändert werden." };
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteVehicleDocAction(formData: FormData): Promise<void> {
  if (!(await requireAccess())) return;
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) return;
  await deleteVehicleDocument(id);
  revalidatePath(PATH);
}

/** Lädt die Dokumentliste eines Fahrzeugs (für die Client-Ansicht nach Auswahl). */
export async function loadVehicleDocsAction(vehicleId: number): Promise<VehicleDocument[]> {
  if (!(await requireAccess())) return [];
  if (!Number.isFinite(vehicleId) || vehicleId <= 0) return [];
  try {
    return await listVehicleDocuments(vehicleId);
  } catch {
    return [];
  }
}
