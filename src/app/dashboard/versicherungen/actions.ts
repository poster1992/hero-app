"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getAllowedModules } from "@/lib/role-store";
import {
  addInsuranceDocument,
  updateInsuranceDocument,
  deleteInsuranceDocument,
  addInsuranceCategory,
  removeInsuranceCategory,
  getAllInsuranceCategories,
  INSURANCE_CATEGORY_PRESETS,
} from "@/lib/insurance-docs";

const PATH = "/dashboard/versicherungen";
const MODULE = "cockpit_versicherungen";
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

export interface InsuranceActionResult {
  ok: boolean;
  error?: string;
  count?: number;
}

/** Lädt ein oder mehrere Dokumente hoch (gemeinsame Kategorie/Beschriftung/Notiz). */
export async function uploadInsuranceDocAction(formData: FormData): Promise<InsuranceActionResult> {
  const user = await requireAccess();
  if (!user) return { ok: false, error: "Kein Zugriff." };

  const category = String(formData.get("category") ?? "").trim() || "Sonstige";
  const label = String(formData.get("label") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;

  const files = formData
    .getAll("file")
    .filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && (f as File).size > 0);

  if (files.length === 0) return { ok: false, error: "Bitte mindestens eine Datei auswählen." };
  for (const f of files) {
    if (f.size > MAX_SIZE) return { ok: false, error: `„${f.name}" ist zu groß (max. 25 MB).` };
  }

  let count = 0;
  try {
    for (const f of files) {
      // Bei mehreren Dateien wird die Beschriftung durchnummeriert, damit sie unterscheidbar bleiben.
      const docLabel = label && files.length > 1 ? `${label} (${count + 1})` : label;
      await addInsuranceDocument({
        category,
        label: docLabel,
        note,
        file: {
          buffer: Buffer.from(await f.arrayBuffer()),
          originalName: f.name,
          mime: f.type || "application/octet-stream",
        },
        uploadedBy: user.id,
      });
      count++;
    }
  } catch {
    return { ok: false, error: "Dokument konnte nicht gespeichert werden." };
  }
  revalidatePath(PATH);
  return { ok: true, count };
}

/** Ändert Kategorie/Beschriftung/Notiz eines Dokuments. */
export async function updateInsuranceDocAction(
  id: number,
  input: { category: string; label: string; note: string | null }
): Promise<InsuranceActionResult> {
  if (!(await requireAccess())) return { ok: false, error: "Kein Zugriff." };
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "Ungültiges Dokument." };
  if (!input.label.trim()) return { ok: false, error: "Bitte eine Beschriftung angeben." };
  try {
    await updateInsuranceDocument(id, input);
  } catch {
    return { ok: false, error: "Änderung konnte nicht gespeichert werden." };
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteInsuranceDocAction(formData: FormData): Promise<void> {
  if (!(await requireAccess())) return;
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) return;
  await deleteInsuranceDocument(id);
  revalidatePath(PATH);
}

export interface CategoriesResult {
  ok: boolean;
  error?: string;
  categories?: string[];
}

/** Legt eine neue Kategorie an und liefert die aktualisierte Liste zurück. */
export async function addInsuranceCategoryAction(name: string): Promise<CategoriesResult> {
  if (!(await requireAccess())) return { ok: false, error: "Kein Zugriff." };
  const clean = String(name ?? "").trim();
  if (!clean) return { ok: false, error: "Bitte einen Namen angeben." };
  try {
    await addInsuranceCategory(clean);
  } catch {
    return { ok: false, error: "Kategorie konnte nicht angelegt werden." };
  }
  revalidatePath(PATH);
  return { ok: true, categories: await getAllInsuranceCategories() };
}

/** Entfernt eine selbst angelegte Kategorie (Presets sind geschützt). */
export async function removeInsuranceCategoryAction(name: string): Promise<CategoriesResult> {
  if (!(await requireAccess())) return { ok: false, error: "Kein Zugriff." };
  const clean = String(name ?? "").trim();
  if (!clean) return { ok: false, error: "Ungültige Kategorie." };
  if (INSURANCE_CATEGORY_PRESETS.some((c) => c.toLowerCase() === clean.toLowerCase())) {
    return { ok: false, error: "Standard-Kategorien können nicht gelöscht werden." };
  }
  try {
    await removeInsuranceCategory(clean);
  } catch {
    return { ok: false, error: "Kategorie konnte nicht entfernt werden." };
  }
  revalidatePath(PATH);
  return { ok: true, categories: await getAllInsuranceCategories() };
}
