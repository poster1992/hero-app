import ReceiptsTableClient, { type ReceiptRow } from "@/components/ReceiptsTableClient";
import {
  getCustomerName,
  getInvoiceStatus,
  getReceiptProjects,
  getDocumentUrl,
} from "@/lib/invoices";
import type { Receipt } from "@/lib/hero-api";

const dateFormatter = new Intl.DateTimeFormat("de-DE");

export default function ReceiptsTable({
  receipts,
  partyLabel = "Kunde",
  showProject = true,
}: {
  receipts: Receipt[];
  partyLabel?: string;
  showProject?: boolean;
}) {
  const rows: ReceiptRow[] = receipts.map((r) => {
    const status = getInvoiceStatus(r);
    const file = r.fileUpload;
    return {
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

  return <ReceiptsTableClient rows={rows} partyLabel={partyLabel} showProject={showProject} />;
}
