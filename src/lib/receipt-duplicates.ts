// Dubletten-Erkennung für Belege (Lieferant + Bruttobetrag + Datum).
// Reine, DB-freie Helfer – nutzbar in Server- und Client-Komponenten.

/**
 * Normalisierter Dubletten-Schlüssel: Lieferant + Bruttobetrag + Belegdatum.
 * Gibt null zurück, wenn die Angaben für einen sinnvollen Vergleich nicht reichen.
 */
export function receiptDupKey(
  supplier: string | null | undefined,
  gross: number,
  dateISO: string | null | undefined
): string | null {
  const s = (supplier ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const d = (dateISO ?? "").slice(0, 10);
  if (!s || !d || !Number.isFinite(gross) || gross === 0) return null;
  return `${s}|${gross.toFixed(2)}|${d}`;
}

export interface DuplicateItem {
  supplier: string | null;
  gross: number;
  dateISO: string | null;
}

export interface DuplicateGroup {
  key: string;
  supplier: string;
  gross: number;
  /** yyyy-mm-dd */
  date: string;
  count: number;
}

/**
 * Baut aus einer Belegliste die Menge der Dubletten-Schlüssel (Anzahl ≥ 2) sowie
 * eine Gruppenübersicht (für einen Warnhinweis).
 */
export function computeReceiptDuplicates(items: DuplicateItem[]): {
  keys: Set<string>;
  groups: DuplicateGroup[];
} {
  const map = new Map<string, DuplicateGroup>();
  for (const it of items) {
    const key = receiptDupKey(it.supplier, it.gross, it.dateISO);
    if (!key) continue;
    const prev = map.get(key);
    if (prev) prev.count++;
    else
      map.set(key, {
        key,
        supplier: (it.supplier ?? "").trim(),
        gross: it.gross,
        date: (it.dateISO ?? "").slice(0, 10),
        count: 1,
      });
  }
  const keys = new Set<string>();
  const groups: DuplicateGroup[] = [];
  for (const g of map.values()) {
    if (g.count >= 2) {
      keys.add(g.key);
      groups.push(g);
    }
  }
  groups.sort((a, b) => b.count - a.count || a.supplier.localeCompare(b.supplier, "de") || b.gross - a.gross);
  return { keys, groups };
}
