import "server-only";
import { getSetting, GOOGLE_PLACES_API_KEY_KEY, GOOGLE_PLACE_ID_KEY } from "./settings";

export interface GoogleReviewStats {
  /** Durchschnittliche Bewertung (0–5) oder null. */
  rating: number | null;
  /** Anzahl der Rezensionen oder null. */
  count: number | null;
  /** true, wenn API-Key + Place-ID konfiguriert sind. */
  configured: boolean;
  error?: string;
}

// Ergebnis kurz cachen (Place Details kostet pro Abruf).
let cache: { at: number; data: GoogleReviewStats } | null = null;
const TTL_MS = 6 * 60 * 60 * 1000; // 6 Stunden

/** Ruft Anzahl + Ø der Google-Rezensionen über die Places API (New) ab. */
export async function getGoogleReviewStats(): Promise<GoogleReviewStats> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;

  const [key, placeId] = await Promise.all([
    getSetting(GOOGLE_PLACES_API_KEY_KEY),
    getSetting(GOOGLE_PLACE_ID_KEY),
  ]);
  const k = key?.trim();
  const pid = placeId?.trim();
  if (!k || !pid) return { rating: null, count: null, configured: false };

  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(pid)}?fields=rating,userRatingCount`,
      { headers: { "X-Goog-Api-Key": k }, cache: "no-store" }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = `Google API ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`;
      return cache?.data ?? { rating: null, count: null, configured: true, error: err };
    }
    const j = (await res.json()) as { rating?: number; userRatingCount?: number };
    const data: GoogleReviewStats = {
      rating: typeof j.rating === "number" ? j.rating : null,
      count: typeof j.userRatingCount === "number" ? j.userRatingCount : null,
      configured: true,
    };
    cache = { at: Date.now(), data };
    return data;
  } catch (e) {
    return cache?.data ?? { rating: null, count: null, configured: true, error: e instanceof Error ? e.message : "Abruf fehlgeschlagen." };
  }
}
