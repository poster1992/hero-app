import type { NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { getPaymentAdviceFile } from "@/lib/payment-advices";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });

  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) return new Response("Ungültige ID", { status: 400 });

  const file = await getPaymentAdviceFile(id);
  if (!file) return new Response("Avis nicht gefunden", { status: 404 });

  return new Response(new Uint8Array(file.data), {
    status: 200,
    headers: {
      "Content-Type": file.mime,
      "Content-Disposition": `inline; filename="${encodeURIComponent(file.name)}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
