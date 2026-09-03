// Client-sichere Typen für das Aufmaß-Modul (KEIN DB-/Node-Import).

/** Eine Aufmaß-Position (Zeile in der Tabelle des Word-Dokuments). */
export interface AufmassPosition {
  /** Raum/Bereich, z. B. „Bad EG". */
  area: string | null;
  /** Beschreibung der Leistung, z. B. „Boden Fliese". */
  description: string | null;
  /** Maße in Metern (soweit auf dem Blatt notiert). */
  length: number | null;
  width: number | null;
  height: number | null;
  /** Anzahl/Faktor (z. B. 3 Stück gleicher Maße). */
  count: number | null;
  /** Menge – abgelesen oder aus den Maßen berechnet. */
  quantity: number | null;
  /** Einheit: m², m, Stk … */
  unit: string | null;
  /** Randnotiz zur Position. */
  note: string | null;
}

/** Vollständig ausgelesenes Aufmaß (Kopf + Positionen + Abschrift). */
export interface AufmassData {
  title: string | null;
  customer: string | null;
  project: string | null;
  address: string | null;
  /** Aufmaß-Datum als YYYY-MM-DD. */
  date: string | null;
  /** Wer das Aufmaß genommen hat (laut Blatt). */
  measuredBy: string | null;
  positions: AufmassPosition[];
  /** Freitext-Bemerkungen vom Blatt. */
  remarks: string | null;
  /** Möglichst wörtliche Abschrift des handschriftlichen Originals. */
  transcript: string | null;
}

export type AufmassStatus = "pending" | "done" | "error";

/** Ein Eintrag im Aufmaß-Archiv. */
export interface AufmassEntry {
  id: number;
  title: string;
  customer: string | null;
  project: string | null;
  date: string | null;
  status: AufmassStatus;
  error: string | null;
  /** Originaldatei (Foto/PDF). */
  fileName: string | null;
  mime: string | null;
  hasFile: boolean;
  /** Erzeugtes Word-Dokument. */
  docxName: string | null;
  hasDocx: boolean;
  positionCount: number;
  createdByName: string | null;
  created: string | null;
}

/** Leeres Datenobjekt (für Fehlerfälle). */
export const EMPTY_AUFMASS: AufmassData = {
  title: null,
  customer: null,
  project: null,
  address: null,
  date: null,
  measuredBy: null,
  positions: [],
  remarks: null,
  transcript: null,
};

/**
 * Ergänzt fehlende Mengen/Einheiten aus den Maßen:
 * L×B → m², nur L → m, sonst Anzahl → Stk. Anzahl wirkt als Faktor.
 */
export function completePosition(p: AufmassPosition): AufmassPosition {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const factor = p.count && p.count > 0 ? p.count : 1;
  let quantity = p.quantity;
  let unit = p.unit;

  if (quantity == null) {
    if (p.length != null && p.width != null) {
      quantity = round2(p.length * p.width * factor);
      unit = unit ?? "m²";
    } else if (p.length != null) {
      quantity = round2(p.length * factor);
      unit = unit ?? "m";
    } else if (p.count != null) {
      quantity = p.count;
      unit = unit ?? "Stk";
    }
  } else {
    quantity = round2(quantity);
    if (!unit) unit = p.length != null && p.width != null ? "m²" : p.length != null ? "m" : "Stk";
  }
  return { ...p, quantity, unit };
}

/** Summen je Einheit über alle Positionen (m², m, Stk …). */
export function sumByUnit(positions: AufmassPosition[]): { unit: string; total: number }[] {
  const map = new Map<string, number>();
  for (const p of positions) {
    if (p.quantity == null) continue;
    const unit = p.unit ?? "—";
    map.set(unit, Math.round(((map.get(unit) ?? 0) + p.quantity) * 100) / 100);
  }
  return [...map.entries()].map(([unit, total]) => ({ unit, total }));
}
