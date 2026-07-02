import { getCustomerDocumentsByType, type CustomerInvoice } from "@/lib/hero-api";
import { getDocumentUrl, type InvoiceStatusTone } from "@/lib/invoices";
import ReceiptsTableClient, { type ReceiptRow } from "@/components/ReceiptsTableClient";

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function statusToTone(status: string | null): InvoiceStatusTone {
  const s = (status ?? "").toLowerCase();
  if (s.includes("storn") || s.includes("lösch") || s.includes("losch")) return "overdue";
  if (s.includes("versend") || s.includes("bezahl") || s.includes("angenommen")) return "paid";
  return "open";
}

function toRow(d: CustomerInvoice): ReceiptRow {
  return {
    id: d.id,
    number: d.number,
    dateStr: d.date ? dateFormatter.format(new Date(d.date)) : "—",
    dueStr: "—",
    party: d.customerName ?? "—",
    projects: d.project ? [{ id: d.project.id, name: d.project.name, relativeId: null }] : [],
    net: d.net,
    tax: d.tax,
    gross: d.gross,
    statusLabel: d.statusName ?? "—",
    statusTone: statusToTone(d.statusName),
    file: d.fileUpload?.src
      ? {
          filename: d.fileUpload.filename,
          docUrl: getDocumentUrl(d.fileUpload.src),
          thumb256: null,
          thumb512: null,
          mime: d.fileUpload.type,
        }
      : null,
  };
}

export default async function DocumentsList({
  title,
  typeIds,
}: {
  title: string;
  typeIds: number[];
}) {
  let rows: ReceiptRow[] | null = null;
  let error: string | null = null;
  try {
    const docs = await getCustomerDocumentsByType(typeIds);
    rows = docs.map(toRow);
  } catch (e) {
    error = e instanceof Error ? e.message : "Unbekannter Fehler beim Laden der Daten.";
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
        {rows && <p className="text-sm text-gray-600">{rows.length} Dokumente</p>}
      </div>

      {error && (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          Fehler beim Laden der Daten von HERO: {error}
        </div>
      )}

      {rows && <ReceiptsTableClient rows={rows} />}
    </>
  );
}
