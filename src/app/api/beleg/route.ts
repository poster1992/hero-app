import type { NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { getManualReceiptFile } from "@/lib/manual-receipts";
import { sniffMime, isPreviewableMime } from "@/lib/file-sniff";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });

  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) return new Response("Ungültige ID", { status: 400 });

  const file = await getManualReceiptFile(id);
  if (!file) return new Response("Beleg nicht gefunden", { status: 404 });

  // Manche Absender liefern Dateien ohne Endung/mit falschem MIME (octet-stream) –
  // dann würde der Browser sie herunterladen statt anzuzeigen. Deshalb den echten
  // Typ aus dem Dateiinhalt bestimmen, wenn der gespeicherte MIME nicht anzeigbar ist.
  let contentType = file.mime;
  if (!isPreviewableMime(contentType)) {
    const sniffed = sniffMime(file.data, contentType || "application/octet-stream");
    if (isPreviewableMime(sniffed)) contentType = sniffed;
  }

  return new Response(new Uint8Array(file.data), {
    status: 200,
    headers: {
      "Content-Type": contentType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${encodeURIComponent(file.name)}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
