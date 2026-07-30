import type { NextRequest } from "next/server";
import { sendDailyReport } from "@/lib/daily-report";

// TEMPORÄR: geschützter Trigger für einen Test-Versand des Tagesberichts.
// Nur mit korrektem token (= AUTH_SECRET) nutzbar. Nach dem Test wieder entfernen.
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!process.env.AUTH_SECRET || token !== process.env.AUTH_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const to = (request.nextUrl.searchParams.get("to") ?? "").trim();
  const recipients = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) ? [to] : undefined;
  const res = await sendDailyReport({ force: true, recipients });
  return Response.json(res);
}
