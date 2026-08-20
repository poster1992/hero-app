import "server-only";
import { getBookAccounts } from "./hero-api";
import { extractBeleg, isConfidentialBeleg } from "./beleg-extract";
import { applySupplierFingerprint } from "./supplier-fingerprints";
import {
  getManualReceiptFile,
  listPendingInboxReceiptIds,
  countPendingInboxReceipts,
  applyAutoExtraction,
  markInboxAutoDone,
} from "./manual-receipts";

/**
 * Hintergrund-Worker: erfasst hochgeladene Posteingang-Belege (auto_status='pending')
 * per OCR und schreibt die erkannten Felder. Läuft serverseitig – daher übersteht der
 * Upload einen Tab-/App-Neustart des Nutzers.
 */
export async function processPendingInboxReceipts(
  limit = 5
): Promise<{ processed: number; remaining: number }> {
  const ids = await listPendingInboxReceiptIds(limit);
  if (ids.length === 0) return { processed: 0, remaining: 0 };

  // Kanonische Kontonamen zur Nummer (best-effort).
  const accountNameByNumber = new Map<string, string>();
  try {
    for (const a of await getBookAccounts()) accountNameByNumber.set(a.number, a.name);
  } catch {
    /* ohne HERO-Konten Fallback-Name */
  }

  let processed = 0;
  for (const id of ids) {
    try {
      const file = await getManualReceiptFile(id);
      if (!file) {
        await markInboxAutoDone(id, "(Datei fehlt – bitte erneut hochladen)");
        processed++;
        continue;
      }

      let ex;
      try {
        ex = await extractBeleg({ buffer: file.data, mime: file.mime, kind: "auto" });
      } catch (e) {
        ex = { ok: false as const, error: e instanceof Error ? e.message : "OCR fehlgeschlagen." };
      }

      if (ex.ok && ex.total != null) {
        // Lieferanten-Erkennung: bekannte Absender (Fingerabdruck im Text) fest zuordnen.
        const fp = await applySupplierFingerprint({
          fullText: ex.fullText,
          supplier: ex.supplier ?? null,
          description: ex.description ?? null,
          accountNumber: ex.accountNumber ?? null,
          accountName: null,
        }).catch(() => null);
        const supplier = fp ? fp.supplier : ex.supplier ?? null;
        const accountNumber = (fp ? fp.accountNumber : ex.accountNumber ?? null) ?? null;
        const accountName = accountNumber
          ? accountNameByNumber.get(accountNumber) ?? fp?.accountName ?? ex.accountName ?? null
          : null;
        const confidential = isConfidentialBeleg(ex.kind, accountName);
        await applyAutoExtraction(id, {
          date: ex.date ?? null,
          supplier,
          description: ex.description ?? null,
          gross: ex.total,
          vatRate: ex.vatRate ?? null,
          accountNumber,
          accountName,
          invoiceNumber: ex.invoiceNumber ?? null,
          skontoAmount: ex.skontoAmount ?? null,
          skontoPayAmount: ex.skontoPayAmount ?? null,
          skontoDueDate: ex.skontoDueDate ?? null,
          ocrText: confidential ? null : ex.fullText ?? null,
          confidential,
        });
      } else {
        await markInboxAutoDone(id, "(automatisch erfasst – nicht erkannt, bitte prüfen)");
      }
      processed++;
    } catch {
      // Nicht hängenbleiben: als erledigt markieren (bleibt als Entwurf prüfbar).
      try {
        await markInboxAutoDone(id, "(Auto-Erfassung fehlgeschlagen – bitte prüfen)");
      } catch {
        /* ignore */
      }
    }
  }

  const remaining = await countPendingInboxReceipts();
  return { processed, remaining };
}
