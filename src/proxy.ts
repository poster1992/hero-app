import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./lib/auth";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    const loginUrl = new URL("/login", request.url);
    const res = NextResponse.redirect(loginUrl);
    // Weiterleitung nie cachen (sonst „hängt" der Browser nach Abmeldung auf einer
    // gecachten geschützten Seite bzw. auf der Login-Weiterleitung).
    res.headers.set("Cache-Control", "no-store, must-revalidate");
    // Ein evtl. noch vorhandenes, aber ungültiges/abgelaufenes Cookie entfernen.
    if (token) res.cookies.delete(SESSION_COOKIE_NAME);
    return res;
  }

  // Geschützte Seiten nie im Browser/Proxy cachen – verhindert veraltete
  // (eingeloggte) Ansichten nach automatischer Abmeldung.
  const res = NextResponse.next();
  res.headers.set("Cache-Control", "no-store, must-revalidate");
  return res;
}

export const config = {
  // Schützt alles außer der Login-Seite, Next-Internas und statischen Dateien
  // (Bilder/Assets müssen auch auf der nicht eingeloggten Login-Seite laden).
  matcher: [
    "/((?!login|sw\\.js|manifest\\.webmanifest|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|gif|svg|webp|ico|geojson)$).*)",
  ],
};
