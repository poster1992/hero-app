/**
 * Feste Farbauswahl für Kontoauszug-Markierungen. Eigene (nicht "server-only")
 * Datei, damit sowohl die Server-Lib (`kontoauszuege.ts`) als auch die
 * Client-Komponente (`KontoauszugClient.tsx`) dieselben Werte nutzen können.
 */
export const MARKER_COLORS = [
  { key: "red", label: "Rot", hex: "#ef4444" },
  { key: "yellow", label: "Gelb", hex: "#eab308" },
  { key: "green", label: "Grün", hex: "#22c55e" },
  { key: "blue", label: "Blau", hex: "#3b82f6" },
  { key: "gray", label: "Grau", hex: "#9ca3af" },
] as const;

export type MarkerColor = (typeof MARKER_COLORS)[number]["key"];

export function markerColorHex(key: string): string {
  return MARKER_COLORS.find((c) => c.key === key)?.hex ?? MARKER_COLORS[0].hex;
}

/** Hex-Farbe (#rrggbb) als [r,g,b] im 0..1-Bereich (für pdf-lib `rgb()`). */
export function markerColorRgb01(key: string): [number, number, number] {
  const hex = markerColorHex(key);
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
