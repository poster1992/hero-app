import { getSession } from "@/lib/session";
import { getStatementFile } from "@/lib/kontoauszuege";

/** Liefert die gemeinsame Kontoauszüge-Sammel-PDF (wächst mit jedem Anhängen). */
export async function GET() {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });

  const data = await getStatementFile();
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
