"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getAllowedModules } from "@/lib/role-store";
import { getBookAccounts } from "@/lib/hero-api";
import { createManualReceipt } from "@/lib/manual-receipts";
import { extractBeleg } from "@/lib/beleg-extract";
import { rotateBuffer } from "@/lib/auto-rotate";

const PATH = "/dashboard/belege";
const MAX_SIZE = 25 * 1024 * 1024;

async function requireAccess() {
  const session = await getSession();
  if (!session) return null;
  const user = await getUserByUsername(session.username);
  if (!user) return null;
  const allowed = await getAllowedModules(user.role);
  // Voller Belege-Zugriff nötig (nicht die eingeschränkte Ansicht).
  if (!allowed.includes("cockpit_belege")) return null;
  return user;
}

export interface InboxItemResult {
  fileName: string;
  ok: boolean;
  /** Erkannter Belegtyp (Anzeigename). */
  kindLabel?: string;
  total?: number;
  date?: string;
  vatRate?: number;
  supplier?: string;
  accountNumber?: string;
  /** true, wenn als unvollständiger Entwurf (nicht erkannt) angelegt. */
  draft?: boolean;
  error?: string;
}

export interface InboxIngestResult {
  ok: boolean;
  error?: string;
  results: InboxItemResult[];
  created: number;
  drafts: number;
}

/**
 * Verarbeitet mehrere hochgeladene Dateien: OCR-Auto-Erkennung + Extraktion,
 * legt je Datei einen manuellen Beleg (source='inbox') an. Nicht erkannte Belege
 * werden als Entwurf mit Datei gespeichert (Felder leer, „bitte prüfen").
 */
export async function ingestInboxBelegeAction(formData: FormData): Promise<InboxIngestResult> {
  const user = await requireAccess();
  if (!user) return { ok: false, error: "Kein Zugriff.", results: [], created: 0, drafts: 0 };

  const uploads = formData
    .getAll("files")
    .filter((u): u is File => typeof u === "object" && u !== null && "arrayBuffer" in u && (u as File).size > 0);
  if (uploads.length === 0) return { ok: false, error: "Keine Dateien.", results: [], created: 0, drafts: 0 };

  // HERO-Buchungskonten einmal laden (kanonischer Kontoname zur Nummer).
  const accountNameByNumber = new Map<string, string>();
  try {
    for (const a of await getBookAccounts()) accountNameByNumber.set(a.number, a.name);
  } catch {
    /* ohne HERO-Konten wird der Fallback-Name verwendet */
  }

  const results: InboxItemResult[] = [];
  let created = 0;
  let drafts = 0;

  for (const f of uploads) {
    const name = f.name || "Beleg";
    if (f.size > MAX_SIZE) {
      results.push({ fileName: name, ok: false, error: "Datei zu groß (max. 25 MB)." });
      continue;
    }
    const buffer = Buffer.from(await f.arrayBuffer());
    const mime = f.type || "application/pdf";
    const file = { buffer, originalName: name, mime };

    let ex;
    try {
      ex = await extractBeleg({ buffer, mime, kind: "auto" });
    } catch (e) {
      ex = { ok: false, error: e instanceof Error ? e.message : "OCR fehlgeschlagen." };
    }

    if (ex.ok && ex.total != null) {
      const accountNumber = ex.accountNumber ?? null;
      const accountName = accountNumber
        ? accountNameByNumber.get(accountNumber) ?? ex.accountName ?? null
        : null;
      // Falsch/verdreht gescannte Belege automatisch aufrichten (0 = keine Drehung).
      const fileToSave = ex.rotation
        ? { buffer: await rotateBuffer(buffer, mime, ex.rotation), originalName: name, mime }
        : file;
      try {
        await createManualReceipt({
          date: ex.date ?? null,
          supplier: ex.supplier ?? null,
          description: ex.description ?? null,
          gross: ex.total,
          vatRate: ex.vatRate ?? null,
          accountNumber,
          accountName,
          file: fileToSave,
          uploadedBy: user.id,
          source: "inbox",
          invoiceNumber: ex.invoiceNumber ?? null,
          skontoAmount: ex.skontoAmount ?? null,
          skontoPayAmount: ex.skontoPayAmount ?? null,
          skontoDueDate: ex.skontoDueDate ?? null,
          // Volltext aus demselben KI-Lauf → sofort durchsuchbar, kein zweiter OCR-Durchlauf.
          ocrText: ex.fullText ?? null,
        });
        created++;
        results.push({
          fileName: name,
          ok: true,
          kindLabel: ex.kindLabel,
          total: ex.total,
          date: ex.date,
          vatRate: ex.vatRate,
          supplier: ex.supplier,
          accountNumber: accountNumber ?? undefined,
        });
      } catch {
        results.push({ fileName: name, ok: false, error: "Speichern fehlgeschlagen." });
      }
    } else {
      // Nicht erkannt → Datei trotzdem als Entwurf ablegen (zum Nacherfassen).
      try {
        await createManualReceipt({
          date: null,
          supplier: null,
          description: "(automatisch erfasst – nicht erkannt, bitte prüfen)",
          gross: 0,
          vatRate: null,
          accountNumber: null,
          accountName: null,
          file,
          uploadedBy: user.id,
          source: "inbox",
        });
        drafts++;
        results.push({ fileName: name, ok: true, draft: true, error: ex.error });
      } catch {
        results.push({ fileName: name, ok: false, error: "Speichern fehlgeschlagen." });
      }
    }
  }

  revalidatePath(PATH);
  return { ok: true, results, created, drafts };
}
