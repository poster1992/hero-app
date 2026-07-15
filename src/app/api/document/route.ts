import type { NextRequest } from "next/server";
import { currentHeroToken } from "@/lib/hero-api";

const HERO_HOST = "https://login.hero-software.de";
// Only allow proxying HERO file paths, nothing else (prevents SSRF via the bearer token).
const ALLOWED_SRC = /^\/files\/[A-Za-z0-9/_.-]+\.(pdf|png|jpe?g|gif|webp)$/i;

export async function GET(request: NextRequest) {
  const src = request.nextUrl.searchParams.get("src");
  if (!src || src.includes("..") || !ALLOWED_SRC.test(src)) {
    return new Response("Invalid document path", { status: 400 });
  }

  const token = await currentHeroToken();
  if (!token) {
    return new Response("HERO_API_TOKEN is not configured", { status: 500 });
  }

  const upstream = await fetch(HERO_HOST + src, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    return new Response("Dokument konnte nicht geladen werden", {
      status: upstream.status === 404 ? 404 : 502,
    });
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=300",
    },
  });
}
