// Manuelle Zuordnung Monteur → Gewerk/Jobtitel.
//
// Hintergrund: HERO pflegt den Jobtitel unter "Anstellung → Grunddaten",
// liefert ihn aber NICHT über die externe GraphQL-API aus. Daher wird die
// Aufteilung der Monteure (Fliesenleger / Hilfsarbeiter) hier von Hand gepflegt.
// Schlüssel = exakter Mitarbeitername (wie in HERO angezeigt).

export type EmployeeTrade = "Fliesenleger" | "Hilfsarbeiter";

export const EMPLOYEE_TRADE: Record<string, EmployeeTrade> = {
  // TODO: tatsächliche Zuordnung eintragen, z. B.:
  // "Andreas Orth": "Fliesenleger",
  // "Stefan Oster": "Fliesenleger",
  // "Patrick Borm": "Hilfsarbeiter",
};

/** Gewerk eines Monteurs; unbekannte werden als Hilfsarbeiter geführt. */
export function tradeOf(name: string): EmployeeTrade {
  return EMPLOYEE_TRADE[name] ?? "Hilfsarbeiter";
}

/**
 * Mitarbeiter, die trotz anderer HERO-Rolle in der Monteur-Gruppe erscheinen sollen
 * (z. B. Filialleiter, der gelegentlich auf Montage hilft).
 */
export const FORCE_MONTEUR = new Set<string>(["Willi Oster", "Manuel Oster", "Pascal Oster"]);

/**
 * Mitarbeiter, deren Kapazität NICHT zum verfügbaren Wochenvolumen zählt
 * (ihre geplanten Stunden werden weiterhin angezeigt, erhöhen aber nicht die Kapazität).
 */
export const NO_CAPACITY = new Set<string>(["Willi Oster", "Manuel Oster", "Pascal Oster"]);

/** Feste Sortierung der Monteure: diese Namen ganz oben (in dieser Reihenfolge). */
export const MONTEUR_TOP = ["Timo Alten", "Andreas Orth", "Stefan Oster"];
/** ... und diese ganz unten (in dieser Reihenfolge). */
export const MONTEUR_BOTTOM = ["Willi Oster", "Manuel Oster", "Pascal Oster"];

/** Sortierschlüssel eines Monteurs (kleiner = weiter oben). */
export function monteurSortKey(name: string): [number, number, string] {
  const top = MONTEUR_TOP.indexOf(name);
  if (top >= 0) return [0, top, name];
  const bottom = MONTEUR_BOTTOM.indexOf(name);
  if (bottom >= 0) return [2, bottom, name];
  return [1, 0, name];
}
