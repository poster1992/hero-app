import ReceiptsTableClient, { type ReceiptRow } from "@/components/ReceiptsTableClient";
import {
  getCustomerName,
  effectiveReceiptStatus,
  getReceiptProjects,
  getDocumentUrl,
} from "@/lib/invoices";
import type { Receipt } from "@/lib/hero-api";
import { reviewStatusLabel, type ReceiptReview } from "@/lib/receipt-reviews";
import { getSupplierIbanMap } from "@/lib/supplier-ibans";
import type { PaymentOverride } from "@/lib/receipt-payment-status";

const dateFormatter = new Intl.DateTimeFormat("de-DE");

export default async function ReceiptsTable({
  receipts,
  partyLabel = "Kunde",
  showProject = true,
  reviews,
  reviewers = [],
  canReview = false,
  enableSepa = false,
  enablePaidStatus = false,
  paymentOverrides,
}: {
  receipts: Receipt[];
  partyLabel?: string;
  showProject?: boolean;
  reviews?: Map<string, ReceiptReview>;
  reviewers?: { id: number; name: string }[];
  canReview?: boolean;
  enableSepa?: boolean;
  /** Erlaubt das manuelle Umstellen des Zahlstatus je Beleg. */
  enablePaidStatus?: boolean;
  /** Lokale Zahlstatus-Overrides je HERO-Beleg-ID. */
  paymentOverrides?: Map<string, PaymentOverride>;
}) {
  // Bankeinzug-Kennzeichen je Lieferant (nur für Belege/SEPA-Ansicht laden).
  let ibanMap: Awaited<ReturnType<typeof getSupplierIbanMap>> = new Map();
  if (enableSepa) {
    try {
      ibanMap = await getSupplierIbanMap();
    } catch {
      // DB optional – Bankeinzug-Markierung entfällt dann nur.
    }
  }

  const rows: ReceiptRow[] = receipts.map((r) => {
    // Effektiver Status: lokaler Override gewinnt; ab 01.06.2026 zählt nur die
    // lokale DB (HERO ignoriert), davor der HERO-Status.
    const ov = paymentOverrides?.get(r.id) ?? null;
    const status = effectiveReceiptStatus(r, ov?.status ?? null);
    const paidOverrideInfo = ov
      ? [ov.setByName, ov.setAt ? dateFormatter.format(new Date(ov.setAt.slice(0, 10) + "T00:00:00")) : null]
          .filter(Boolean)
          .join(" · ") || null
      : null;
    const file = r.fileUpload;
    const rv = reviews?.get(r.id) ?? null;
    return {
      review: rv
        ? {
            status: rv.status,
            statusLabel: reviewStatusLabel(rv.status),
            assignedToName: rv.assignedToName,
            reviewedByName: rv.reviewedByName,
            reviewedAt: rv.reviewedAt,
            note: rv.note,
            history: rv.history.map((h) => ({
              actionLabel: h.actionLabel,
              detail: h.detail,
              byName: h.byName,
              at: h.at,
            })),
          }
        : null,
      id: r.id,
      number: r.number,
      dateStr: r.receiptDate ? dateFormatter.format(new Date(r.receiptDate)) : "—",
      dueStr: r.dueDate ? dateFormatter.format(new Date(r.dueDate)) : "—",
      party: getCustomerName(r),
      projects: getReceiptProjects(r).map((p) => ({
        id: p.id,
        name: p.name,
        relativeId: p.relativeId,
      })),
      net: r.netValue,
      tax: r.value - r.netValue,
      gross: r.value,
      supplierId: r.customer?.id ?? null,
      open: r.openAmount,
      directDebit: r.customer?.id != null ? (ibanMap.get(r.customer.id)?.directDebit ?? false) : false,
      statusLabel: status.label,
      statusTone: status.tone,
      paidOverride: ov?.status ?? null,
      paidOverrideInfo,
      file:
        file?.src != null
          ? {
              filename: file.filename,
              docUrl: getDocumentUrl(file.src),
              thumb256: file.thumbnails?.fit256 ?? null,
              thumb512: file.thumbnails?.fit512 ?? null,
              mime: file.type,
            }
          : null,
    };
  });

  return (
    <ReceiptsTableClient
      rows={rows}
      partyLabel={partyLabel}
      showProject={showProject}
      reviewers={reviewers}
      canReview={canReview}
      enableSepa={enableSepa}
      enablePaidStatus={enablePaidStatus}
    />
  );
}
