import type { NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getAllowedModules } from "@/lib/role-store";
import { getVehicleDocumentFile } from "@/lib/vehicles";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });
  const user = await getUserByUsername(session.username);
  if (!user) return new Response("Kein Zugriff", { status: 403 });
  const allowed = await getAllowedModules(user.role);
  if (!allowed.includes("cockpit_fahrzeuge")) return new Response("Kein Zugriff", { status: 403 });

  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) return new Response("Ungültige ID", { status: 400 });

  const file = await getVehicleDocumentFile(id);
  if (!file) return new Response("Dokument nicht gefunden", { status: 404 });

  return new Response(new Uint8Array(file.data), {
    status: 200,
    headers: {
      "Content-Type": file.mime,
      "Content-Disposition": `inline; filename="${encodeURIComponent(file.name)}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
