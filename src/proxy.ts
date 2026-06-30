import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./lib/auth";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Schützt alles außer der Login-Seite, Next-Internas und statischen Dateien
  // (Bilder/Assets müssen auch auf der nicht eingeloggten Login-Seite laden).
  matcher: [
    "/((?!login|sw\\.js|manifest\\.webmanifest|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|gif|svg|webp|ico|geojson)$).*)",
  ],
};
