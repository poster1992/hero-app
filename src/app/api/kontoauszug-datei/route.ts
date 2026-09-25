import type { NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { getStatementFile, getStatementFileWithSelection } from "@/lib/kontoauszuege";

/**
 * Liefert die gemeinsame Kontoauszüge-Sammel-PDF (wächst mit jedem Anhängen).
 * Optional `?highlight=<id>`: markiert diese eine Textmarker-Stelle zusätzlich
 * mit einem blauen Rahmen (nur für diese Anfrage), damit beim Springen von
 * einem Marker aus sofort erkennbar ist, welche Markierung gemeint ist.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });

  const highlightParam = request.nextUrl.searchParams.get("highlight");
  const highlightId = highlightParam != null ? Number(highlightParam) : null;
  const data =
    highlightId != null && Number.isFinite(highlightId)
      ? await getStatementFileWithSelection(highlightId)
      : await getStatementFile();
  if (!data) return new Response("Noch keine Kontoauszüge hochgeladen.", { status: 404 });

  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="kontoauszuege.pdf"',
      // Wächst laufend – nie aus dem Cache anzeigen.
      "Cache-Control": "private, no-store",
    },
  });
}
