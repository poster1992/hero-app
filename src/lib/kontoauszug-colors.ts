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
