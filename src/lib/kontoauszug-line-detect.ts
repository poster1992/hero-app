/**
 * Erkennt Buchungszeilen + Beträge aus dem Text-Layer einer PDF-Seite
 * (pdfjs `getTextContent()`). Läuft rein client-seitig (kein Server-OCR
 * nötig, deutlich präziser als Bild-OCR, solange die PDF einen echten
 * Text-Layer hat – bei eingescannten Auszügen ohne Text-Layer liefert das
 * nichts, dafür bleibt das manuelle Markieren im Beleg-Zuordnen-Fenster).
 */

export interface DetectedLine {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  amount: number;
}

/** Nur der Ausschnitt eines pdfjs-`TextItem`, den wir brauchen. */
export interface MinimalTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

// Deutsches Betragsformat: 1.234,56 oder 1234,56, optional führendes Minus.
const AMOUNT_RE = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;
// Zeilen, die nur aus Datum(en) bestehen, sind keine Beträge – grobe Heuristik reicht hier nicht,
// die Betragssuche selbst filtert über das Dezimalkomma-Format ausreichend genau.

// Eröffnungs-/Schluss-/Anfangs-/Endsaldo sind keine Buchungen (Eingänge/Abgänge), sondern
// Kontostände – sollen nicht als Zeile erkannt werden.
const EXCLUDE_RE = /saldo|kontostand/i;

/** Gruppiert Textelemente einer Seite zu Zeilen (nach Y-Position) und erkennt je Zeile einen Betrag. */
export function detectLinesOnPage(page: number, items: MinimalTextItem[]): DetectedLine[] {
  const withText = items.filter((it) => it.str.trim().length > 0);
  const sorted = [...withText].sort((a, b) => b.transform[5] - a.transform[5]); // oben → unten

  const TOL = 2.5; // Punkte Toleranz für "dieselbe Zeile"
  const groups: { items: MinimalTextItem[]; y: number }[] = [];
  for (const it of sorted) {
    const y = it.transform[5];
    const group = groups.find((g) => Math.abs(g.y - y) <= TOL);
    if (group) {
      group.items.push(it);
      group.y = (group.y * (group.items.length - 1) + y) / group.items.length;
    } else {
      groups.push({ items: [it], y });
    }
  }

  const result: DetectedLine[] = [];
  for (const g of groups) {
    const ordered = [...g.items].sort((a, b) => a.transform[4] - b.transform[4]);
    const text = ordered.map((it) => it.str).join(" ");
    if (EXCLUDE_RE.test(text)) continue; // Eröffnungs-/Schlusssaldo & Co. sind keine Ein-/Abgänge.
    const matches = text.match(AMOUNT_RE);
    if (!matches || matches.length === 0) continue;
    // Der Betrag steht in Kontoauszügen fast immer am Zeilenende.
    const last = matches[matches.length - 1];
    const amount = Number(last.replace(/\./g, "").replace(",", ".").replace(/^-/, ""));
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const minX = Math.min(...g.items.map((it) => it.transform[4]));
    const maxX = Math.max(...g.items.map((it) => it.transform[4] + it.width));
    const minY = Math.min(...g.items.map((it) => it.transform[5] - it.height * 0.25));
    const maxY = Math.max(...g.items.map((it) => it.transform[5] + it.height));
    result.push({
      page,
      x: Math.max(0, minX - 2),
      y: minY,
      width: maxX - minX + 4,
      height: maxY - minY,
      amount,
    });
  }
  return result;
}
