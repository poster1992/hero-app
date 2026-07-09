"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import {
  createManualReceipt,
  setManualReceiptPaid,
  updateManualReceipt,
  deleteManualReceipt,
  getManualReceipt,
} from "@/lib/manual-receipts";
import { getBookAccounts, getProjects } from "@/lib/hero-api";
import type { EditableReceipt, ProjectOption } from "@/components/ManualBelegeForm";
import {
  addChecklistItem,
  removeChecklistItem,
  setChecklistDone,
} from "@/lib/belege-checklist";
import { extractBeleg, type BelegSumKind, type BelegSumResult } from "@/lib/beleg-extract";

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

  // Optionale Projektzuordnung: verstecktes Feld "project" = "id|relativeId|name".
  const projectRaw = String(formData.get("project") ?? "").trim();
  let projectId: number | null = null;
  let projectRelativeId: number | null = null;
  let projectName: string | null = null;
  if (projectRaw) {
    const [pid, prel, ...rest] = projectRaw.split("|");
    const idN = Number(pid);
    if (Number.isFinite(idN) && idN > 0) projectId = idN;
    const relN = Number(prel);
    if (Number.isFinite(relN) && relN > 0) projectRelativeId = relN;
    const nm = rest.join("|").trim();
    if (nm) projectName = nm;
  }

  // Belegnummer + Skonto (v. a. Etges & Dächer).
  const invoiceNumber = String(formData.get("invoiceNumber") ?? "").trim() || null;
  const skontoAmountRaw = String(formData.get("skontoAmount") ?? "").trim().replace(",", ".");
  const skontoAmountN = skontoAmountRaw ? Number(skontoAmountRaw) : null;
  const skontoAmount = skontoAmountN != null && Number.isFinite(skontoAmountN) ? skontoAmountN : null;
  const skontoPayAmountRaw = String(formData.get("skontoPayAmount") ?? "").trim().replace(",", ".");
  const skontoPayAmountN = skontoPayAmountRaw ? Number(skontoPayAmountRaw) : null;
  const skontoPayAmount =
    skontoPayAmountN != null && Number.isFinite(skontoPayAmountN) ? skontoPayAmountN : null;
  const skontoDueDate = String(formData.get("skontoDueDate") ?? "").trim() || null;

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
      projectId,
      projectRelativeId,
      projectName,
      invoiceNumber,
      skontoAmount,
      skontoPayAmount,
      skontoDueDate,
    });
  } catch {
    return { error: "Beleg konnte nicht gespeichert werden." };
  }

  revalidatePath(PATH);
  return { success: "Beleg gespeichert." };
}

export async function updateBelegAction(
  _prev: UploadBelegState,
  formData: FormData
): Promise<UploadBelegState> {
  const session = await getSession();
  if (!session) return { error: "Nicht angemeldet." };

  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) return { error: "Ungültiger Beleg." };

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

  // Optionale Projektzuordnung: verstecktes Feld "project" = "id|relativeId|name".
  const projectRaw = String(formData.get("project") ?? "").trim();
  let projectId: number | null = null;
  let projectRelativeId: number | null = null;
  let projectName: string | null = null;
  if (projectRaw) {
    const [pid, prel, ...rest] = projectRaw.split("|");
    const idN = Number(pid);
    if (Number.isFinite(idN) && idN > 0) projectId = idN;
    const relN = Number(prel);
    if (Number.isFinite(relN) && relN > 0) projectRelativeId = relN;
    const nm = rest.join("|").trim();
    if (nm) projectName = nm;
  }

  // Belegnummer + Skonto (v. a. Etges & Dächer).
  const invoiceNumber = String(formData.get("invoiceNumber") ?? "").trim() || null;
  const skontoAmountRaw = String(formData.get("skontoAmount") ?? "").trim().replace(",", ".");
  const skontoAmountN = skontoAmountRaw ? Number(skontoAmountRaw) : null;
  const skontoAmount = skontoAmountN != null && Number.isFinite(skontoAmountN) ? skontoAmountN : null;
  const skontoPayAmountRaw = String(formData.get("skontoPayAmount") ?? "").trim().replace(",", ".");
  const skontoPayAmountN = skontoPayAmountRaw ? Number(skontoPayAmountRaw) : null;
  const skontoPayAmount =
    skontoPayAmountN != null && Number.isFinite(skontoPayAmountN) ? skontoPayAmountN : null;
  const skontoDueDate = String(formData.get("skontoDueDate") ?? "").trim() || null;

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
    await updateManualReceipt({
      id,
      date,
      supplier,
      description,
      gross,
      vatRate,
      accountNumber,
      accountName,
      file,
      projectId,
      projectRelativeId,
      projectName,
      invoiceNumber,
      skontoAmount,
      skontoPayAmount,
      skontoDueDate,
    });
  } catch {
    return { error: "Beleg konnte nicht aktualisiert werden." };
  }

  revalidatePath(PATH);
  return { success: "Beleg aktualisiert." };
}

/**
 * Liest die Werte eines hochgeladenen Belegs per OCR aus (Betrag/MwSt/Datum/
 * Lieferant/Beschreibung/Konto). kind="auto" erkennt den Typ automatisch.
 * Dünner Wrapper um `extractBeleg` (Kern in src/lib/beleg-extract.ts).
 */
export async function computeBelegSumAction(formData: FormData): Promise<BelegSumResult> {
  if (!(await getSession())) return { ok: false, error: "Nicht angemeldet." };

  const kindRaw = String(formData.get("kind") ?? "");
  const allowed: BelegSumKind[] = ["bgl", "mixvoip", "palettecad", "activite", "herosoftware", "circle", "etges", "niederer", "raabkarcher", "fliesenzentrum", "etbkenn", "kiesel", "moselbaustoff", "postdeep", "johanntrierweiler", "akemi", "maroldt", "hieronimi", "kennerbeton", "bureaucaisse", "sigre", "carlgeisen", "wohlwert", "ibod"];
  const kind: BelegSumKind | "auto" =
    kindRaw === "auto" ? "auto" : allowed.includes(kindRaw as BelegSumKind) ? (kindRaw as BelegSumKind) : "lohn";

  const upload = formData.get("file");
  if (!upload || typeof upload !== "object" || !("arrayBuffer" in upload) || (upload as File).size === 0) {
    return { ok: false, error: "Bitte zuerst die Datei auswählen." };
  }
  const f = upload as File;
  if (f.size > 25 * 1024 * 1024) return { ok: false, error: "Datei zu groß (max. 25 MB)." };

  const buffer = Buffer.from(await f.arrayBuffer());
  return extractBeleg({ buffer, mime: f.type || "application/pdf", kind });
}

export interface BelegEditData {
  receipt: EditableReceipt | null;
  accounts: { number: string; name: string }[];
  projects: ProjectOption[];
}

/**
 * Lädt einen manuellen Beleg samt Konten-/Projektlisten zum Bearbeiten
 * (z. B. aus der Aufgaben-Ansicht heraus).
 */
export async function loadBelegEditDataAction(id: number): Promise<BelegEditData> {
  const session = await getSession();
  if (!session || !Number.isFinite(id) || id <= 0) {
    return { receipt: null, accounts: [], projects: [] };
  }
  const [r, accounts, projects] = await Promise.all([
    getManualReceipt(id),
    getBookAccounts().catch(() => [] as { number: string; name: string }[]),
    getProjects().catch(() => [] as ProjectOption[]),
  ]);
  const receipt: EditableReceipt | null = r
    ? {
        id: r.id,
        date: r.date,
        supplier: r.supplier,
        description: r.description,
        gross: r.gross,
        vatRate: r.vatRate,
        accountNumber: r.accountNumber,
        accountName: r.accountName,
        fileName: r.fileName,
        projectId: r.projectId,
        projectRelativeId: r.projectRelativeId,
        projectName: r.projectName,
        invoiceNumber: r.invoiceNumber,
        skontoAmount: r.skontoAmount,
        skontoPayAmount: r.skontoPayAmount,
        skontoDueDate: r.skontoDueDate,
      }
    : null;
  return { receipt, accounts, projects };
}

/** Löscht einen manuellen Beleg (inkl. Datei). */
export async function deleteBelegAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) return;
  await deleteManualReceipt(id);
  revalidatePath(PATH);
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

/** Hakt einen Checklisten-Punkt für einen Monat ab bzw. wieder ab. */
export async function toggleChecklistAction(
  itemId: number,
  year: number,
  month: number,
  done: boolean
): Promise<void> {
  const session = await getSession();
  if (!session) return;
  if (!Number.isFinite(itemId) || itemId <= 0) return;
  await setChecklistDone(itemId, year, month, done);
  revalidatePath(PATH);
}

/** Fügt einen wiederkehrenden Checklisten-Punkt hinzu. */
export async function addChecklistItemAction(label: string): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const trimmed = label.trim();
  if (!trimmed) return;
  await addChecklistItem(trimmed);
  revalidatePath(PATH);
}

/** Entfernt einen Checklisten-Punkt (Historie bleibt erhalten). */
export async function removeChecklistItemAction(itemId: number): Promise<void> {
  const session = await getSession();
  if (!session) return;
  if (!Number.isFinite(itemId) || itemId <= 0) return;
  await removeChecklistItem(itemId);
  revalidatePath(PATH);
}
