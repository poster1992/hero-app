import ReceiptsTableClient, { type ReceiptRow } from "@/components/ReceiptsTableClient";
import {
  getCustomerName,
  getInvoiceStatus,
  getReceiptProjects,
  getDocumentUrl,
} from "@/lib/invoices";
import type { Receipt } from "@/lib/hero-api";
import { reviewStatusLabel, type ReceiptReview } from "@/lib/receipt-reviews";

const dateFormatter = new Intl.DateTimeFormat("de-DE");

export default function ReceiptsTable({
  receipts,
  partyLabel = "Kunde",
  showProject = true,
  reviews,
  reviewers = [],
  canReview = false,
  enableSepa = false,
}: {
  receipts: Receipt[];
  partyLabel?: string;
  showProject?: boolean;
  reviews?: Map<string, ReceiptReview>;
  reviewers?: { id: number; name: string }[];
  canReview?: boolean;
  enableSepa?: boolean;
}) {
  const rows: ReceiptRow[] = receipts.map((r) => {
    const status = getInvoiceStatus(r);
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
      statusLabel: status.label,
      statusTone: status.tone,
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
    />
  );
}
