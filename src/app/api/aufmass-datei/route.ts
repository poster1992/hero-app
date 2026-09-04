import type { NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getAllowedModules } from "@/lib/role-store";
import { getAufmass, getAufmassDocx, getAufmassSource } from "@/lib/aufmass";
import { aufmassXlsxFileName, buildAufmassXlsx } from "@/lib/aufmass-xlsx";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Liefert die Dateien eines Aufmaßes:
 *  ?id=<n>            → Originaldatei (Foto/PDF, inline)
 *  ?id=<n>&typ=word   → erzeugtes Word-Dokument (Download)
 *  ?id=<n>&typ=excel  → Excel-Tabelle, live aus den ausgelesenen Daten erzeugt (Download)
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });
  const user = await getUserByUsername(session.username);
  if (!user) return new Response("Kein Zugriff", { status: 403 });
  const allowed = await getAllowedModules(user.role);
  if (!allowed.includes("cockpit_aufmass")) return new Response("Kein Zugriff", { status: 403 });

  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) return new Response("Ungültige ID", { status: 400 });

  if (request.nextUrl.searchParams.get("typ") === "word") {
    const doc = await getAufmassDocx(id);
    if (!doc) return new Response("Word-Dokument nicht gefunden", { status: 404 });
    return new Response(new Uint8Array(doc.data), {
      status: 200,
      headers: {
        "Content-Type": DOCX_MIME,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(doc.name)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (request.nextUrl.searchParams.get("typ") === "excel") {
    const entry = await getAufmass(id);
    if (!entry || entry.data.positions.length === 0) {
      return new Response("Aufmaß nicht gefunden", { status: 404 });
    }
    const buffer = await buildAufmassXlsx(entry.data, {
      sourceFileName: entry.fileName,
      createdByName: entry.createdByName,
    });
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": XLSX_MIME,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(aufmassXlsxFileName(entry.data))}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const file = await getAufmassSource(id);
  if (!file) return new Response("Datei nicht gefunden", { status: 404 });
  return new Response(new Uint8Array(file.data), {
    status: 200,
    headers: {
      "Content-Type": file.mime,
      "Content-Disposition": `inline; filename="${encodeURIComponent(file.name)}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
