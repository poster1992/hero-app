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
  /** Buchungsdatum (ISO yyyy-mm-dd), falls in der Zeile ein Datum erkannt wurde. */
  date: string | null;
}

/** Nur der Ausschnitt eines pdfjs-`TextItem`, den wir brauchen. */
export interface MinimalTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

// Deutsches Betragsformat: Tausendertrenner als Punkt ODER (normales/geschütztes)
// Leerzeichen – je nach Bank z.B. "1.234,56" oder "2 330,90". Unser eigenes
// Zusammensetzen der Zeile (join(" ")) fügt zwischen getrennten Textelementen
// ohnehin ein normales Leerzeichen ein, falls die Bank den Tausenderteil als
// eigenes PDF-Textelement ausgibt.
const AMOUNT_RE = /-?\d{1,3}(?:[.  ]\d{3})*,\d{2}/g;
// Zeilen, die nur aus Datum(en) bestehen, sind keine Beträge – grobe Heuristik reicht hier nicht,
// die Betragssuche selbst filtert über das Dezimalkomma-Format ausreichend genau.

// Eröffnungs-/Schluss-/Anfangs-/Endsaldo, Tagesabschluss-Summenzeilen und
// Kontostände sind keine einzelnen Buchungen (Eingänge/Abgänge) – nicht erkennen.
const EXCLUDE_RE = /saldo|kontostand|summe|tagesabschluss/i;

// Datum als DD/MM/YY(YY) oder DD.MM.YY(YY) – Kontoauszüge zeigen oft zwei Daten
// (Wertstellung/Buchung) am Zeilenanfang, wir nehmen das erste.
const DATE_RE = /(\d{2})[./](\d{2})[./](\d{2,4})/;

/** Wandelt das erste gefundene Datum einer Zeile in ISO (yyyy-mm-dd) um, oder null. */
function parseLineDate(text: string): string | null {
  const m = text.match(DATE_RE);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (m[3].length === 2) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

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
    const amount = Number(last.replace(/[.  ]/g, "").replace(",", ".").replace(/^-/, ""));
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
      date: parseLineDate(text),
    });
  }
  return result;
}
