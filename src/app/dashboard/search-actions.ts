"use server";

import { getProjects, getReceiptsInRange, getCustomerDocumentsByType } from "@/lib/hero-api";
import { getCustomerName, effectiveReceiptStatus, type InvoiceStatusTone } from "@/lib/invoices";
import { listAllManualReceipts, searchManualOcrIds } from "@/lib/manual-receipts";
import { searchOcrHeroIds } from "@/lib/receipt-ocr";
import { getLineReceiptFileUrl } from "@/lib/kontoauszuege";
import { getPaymentOverrideMap } from "@/lib/receipt-payment-status";
import { isAdmin } from "@/lib/session";
import { DOC_KINDS, type DocKind } from "@/lib/document-kinds";

/** Zahlstatus-Ton für manuelle Belege – Bezahlt/Teilw./Offen wie im Dubletten-Popup, bewusst ohne Überfällig-Unterscheidung (nur Vorschau). */
export type SearchReceiptTone = InvoiceStatusTone | "partial";

export interface SearchProject {
  id: number;
  relativeId: number | null;
  name: string;
  customerName: string | null;
}

/** Project list for the global search (loaded lazily on first use). */
export async function listProjectsForSearch(): Promise<SearchProject[]> {
  const projects = await getProjects();
  return projects.map((p) => ({
    id: p.id,
    relativeId: p.relativeId,
    name: p.name,
    customerName: p.customerName,
  }));
}

export interface GlobalSearchReceipt {
  kind: "manual" | "hero";
  ref: string;
  supplier: string | null;
  invoiceNumber: string | null;
  date: string | null;
  gross: number;
  statusLabel: string;
  statusTone: SearchReceiptTone;
}

/**
 * Beleg-Schlagwortsuche für die globale Suche (nur Administratoren) – gleiches
 * Merge-Muster (HERO + manuell, OCR + Feldabgleich, Fehler-Teilausfall) wie
 * `searchReceiptsForFixkosten()` in `src/lib/fixkosten.ts`, aber ohne deren
 * "nur offene Belege"-Filter und mit dem vollen (Brutto-)Betrag statt Netto –
 * hier geht es nur um eine schnelle Vorschau, nicht um Buchhaltungslogik.
 */
export async function searchBelegeGlobalAction(query: string): Promise<GlobalSearchReceipt[]> {
  if (!(await isAdmin())) return [];
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const results: GlobalSearchReceipt[] = [];

  try {
    const [manualReceipts, manualOcrIds] = await Promise.all([listAllManualReceipts(), searchManualOcrIds(q)]);
    for (const r of manualReceipts) {
      const hit =
        (r.supplier ?? "").toLowerCase().includes(q) ||
        (r.invoiceNumber ?? "").toLowerCase().includes(q) ||
        manualOcrIds.has(r.id);
      if (!hit) continue;
      const status: { label: string; tone: SearchReceiptTone } = r.isPaid
        ? { label: "Bezahlt", tone: "paid" }
        : r.paidAmount > 0
          ? { label: `Teilw. bezahlt · Rest ${r.openAmount.toFixed(2)} €`, tone: "partial" }
          : { label: "Offen", tone: "open" };
      results.push({
        kind: "manual",
        ref: String(r.id),
        supplier: r.supplier,
        invoiceNumber: r.invoiceNumber,
        date: r.date,
        gross: r.gross,
        statusLabel: status.label,
        statusTone: status.tone,
      });
    }
  } catch {
    // Teilausfall ok – HERO-Treffer können trotzdem noch kommen.
  }

  try {
    const to = new Date();
    const from = new Date();
    from.setFullYear(from.getFullYear() - 3);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const [heroReceipts, heroOcrIds, paymentOverrides] = await Promise.all([
      getReceiptsInRange(`${fmt(from)}T00:00:00Z`, `${fmt(to)}T23:59:59Z`),
      searchOcrHeroIds(q),
      getPaymentOverrideMap().catch(() => new Map()),
    ]);
    for (const r of heroReceipts) {
      const supplierName = getCustomerName(r);
      const hit =
        supplierName.toLowerCase().includes(q) || (r.number ?? "").toLowerCase().includes(q) || heroOcrIds.has(r.id);
      if (!hit) continue;
      const status = effectiveReceiptStatus(r, paymentOverrides.get(r.id)?.status ?? null);
      results.push({
        kind: "hero",
        ref: r.id,
        supplier: supplierName,
        invoiceNumber: r.number,
        date: r.receiptDate ? r.receiptDate.slice(0, 10) : null,
        gross: r.value,
        statusLabel: status.label,
        statusTone: status.tone,
      });
    }
  } catch {
    // Teilausfall ok – manuelle Treffer wurden ggf. schon gefunden.
  }

  return results.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 8);
}

/**
 * Löst die Dokument-URL eines Beleg-Suchtreffers auf, zum direkten Öffnen in
 * einem neuen Tab. Manuelle Belege werden auf der Belege-Seite bei aktiver
 * Volltextsuche bewusst ausgeblendet (dort gibt es keinen manuellen OCR-
 * Abgleich) – darum öffnet die globale Suche den Beleg direkt, statt zu einer
 * gefilterten Liste zu navigieren, die ihn gar nicht zeigen würde.
 */
export async function getGlobalBelegFileUrlAction(
  kind: "manual" | "hero",
  ref: string
): Promise<{ url: string | null; error?: string }> {
  if (!(await isAdmin())) return { url: null, error: "Kein Zugriff." };
  return getLineReceiptFileUrl(kind, ref);
}

export interface GlobalSearchDocument {
  kind: DocKind;
  id: string;
  number: string;
  customerName: string | null;
  date: string | null;
  gross: number;
}

/**
 * Dokument-Schlagwortsuche (Angebote/Aufträge/Rechnungen) für die globale
 * Suche (nur Administratoren). Es gibt keine OCR auf den Dokumentinhalt
 * (HERO-generierte Dokumente, keine gescannten Belege) – die Suche läuft
 * daher nur auf Dokumentnummer und Kundenname.
 */
export async function searchDocumentsGlobalAction(query: string): Promise<GlobalSearchDocument[]> {
  if (!(await isAdmin())) return [];
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const results: GlobalSearchDocument[] = [];
  for (const kind of Object.keys(DOC_KINDS) as DocKind[]) {
    try {
      const docs = await getCustomerDocumentsByType(DOC_KINDS[kind].typeIds);
      for (const d of docs) {
        const hit = (d.number ?? "").toLowerCase().includes(q) || (d.customerName ?? "").toLowerCase().includes(q);
        if (!hit) continue;
        results.push({
          kind,
          id: d.id,
          number: d.number,
          customerName: d.customerName,
          date: d.date ? d.date.slice(0, 10) : null,
          gross: d.gross,
        });
      }
    } catch {
      // Teilausfall ok – andere Dokumentarten können trotzdem noch Treffer liefern.
    }
  }

  return results.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 8);
}
