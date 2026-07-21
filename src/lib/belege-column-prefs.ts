import { getSetting, setSetting } from "./settings";

/**
 * Pro-User-Konfiguration, welche Spalten der manuellen Belegtabelle AUSGEBLENDET
 * sind. Gespeichert als JSON-Array von Spalten-Keys im globalen app_settings-Store
 * unter einem benutzerspezifischen Schlüssel (kein Schema-Update nötig).
 */
const keyFor = (userId: number) => `belege_columns_hidden:${userId}`;

/** Gültige (ausblendbare) Spalten-Keys der manuellen Belegtabelle. */
export const BELEG_COLUMN_KEYS = [
  "id",
  "datum",
  "lieferant",
  "belegnr",
  "konto",
  "projekt",
  "netto",
  "mwst",
  "brutto",
  "skonto",
  "skontozahl",
  "skontobis",
  "status",
] as const;

export type BelegColumnKey = (typeof BELEG_COLUMN_KEYS)[number];

const isValidKey = (v: unknown): v is BelegColumnKey =>
  typeof v === "string" && (BELEG_COLUMN_KEYS as readonly string[]).includes(v);

/** Liefert die ausgeblendeten Spalten-Keys eines Users (leer = alle sichtbar). */
export async function getHiddenBelegColumns(userId: number): Promise<BelegColumnKey[]> {
  const raw = await getSetting(keyFor(userId));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(isValidKey) : [];
  } catch {
    return [];
  }
}

/** Speichert die ausgeblendeten Spalten-Keys eines Users. */
export async function setHiddenBelegColumns(userId: number, hidden: string[]): Promise<void> {
  const clean = [...new Set(hidden.filter(isValidKey))];
  await setSetting(keyFor(userId), JSON.stringify(clean));
}
