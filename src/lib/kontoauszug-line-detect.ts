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
// `\b` vor der ersten Ziffer ist wichtig: ohne Wortgrenze kann die Suche sonst
// MITTEN in einer fremden Zahl (z.B. den letzten 3 Ziffern einer IBAN wie
// "...0065 8328") zu matchen anfangen und diese fälschlich als Tausender-
// Vorsilbe an einen danebenstehenden echten Betrag anhängen (reproduzierter
// Bug: "...8328" + " 402,36" -> "328.402,36" statt korrekt "402,36"). Digit-
// Digit-Übergänge sind in `\b`-Logik keine Wortgrenze, Zahlen können also nur
// an ihrem echten Anfang (nach Leerzeichen/Satzzeichen) zu matchen beginnen.
const AMOUNT_RE = /-?\b\d{1,3}(?:[.  ]\d{3})*,\d{2}/g;
// Zeilen, die nur aus Datum(en) bestehen, sind keine Beträge – grobe Heuristik reicht hier nicht,
// die Betragssuche selbst filtert über das Dezimalkomma-Format ausreichend genau.

// Eröffnungs-/Schluss-/Anfangs-/Endsaldo, Tagesabschluss-Summenzeilen und
// Kontostände sind keine einzelnen Buchungen (Eingänge/Abgänge) – nicht erkennen.
const EXCLUDE_RE = /saldo|kontostand|summe|tagesabschluss/i;

// Datum als DD/MM/YY(YY) oder DD.MM.YY(YY) – Kontoauszüge zeigen oft zwei Daten
// (Wertstellung/Buchung) am Zeilenanfang, wir nehmen das erste.
const DATE_RE = /(\d{2})[./](\d{2})[./](\d{2,4})/;

/**
 * Baut den durchsuchbaren Zeilentext aus den (nach X sortierten) Textelementen
 * einer Zeile zusammen – mit einem auf dem Zwischenraum basierenden Trenner
 * statt eines starren Leerzeichens. Ein schmaler Zwischenraum (knapp über der
 * lokalen Zeichenbreite) gilt als Trennung INNERHALB eines Felds (z.B. eine von
 * der Bank per Leerzeichen gruppierte Zahl wie "2 330,90") und bleibt ein
 * normales Leerzeichen, über das `AMOUNT_RE`s Tausendertrenner greifen darf.
 * Ein deutlich größerer Zwischenraum trennt dagegen unterschiedliche Spalten
 * (z.B. Referenznummer/IBAN-Feld vs. Betragsspalte) und bekommt einen
 * Trenner, den `AMOUNT_RE` NICHT als Tausendertrenner lesen kann – sonst
 * verschmelzen fremde Zahlen (IBAN-Endziffern, Referenznummern) fälschlich
 * mit dem danebenstehenden echten Betrag (zwei reproduzierte Bugs: eine IBAN
 * endend auf "...0065 8328" + " 402,36" wurde zu "328.402,36", eine IBAN
 * endend auf "...5192 54" + " 512,26" wurde zu "54.512,26" statt korrekt
 * "402,36" bzw. "512,26").
 */
function buildLineText(ordered: MinimalTextItem[]): string {
  let text = "";
  for (let i = 0; i < ordered.length; i++) {
    const it = ordered[i];
    if (i > 0) {
      const prev = ordered[i - 1];
      const gap = it.transform[4] - (prev.transform[4] + prev.width);
      const avgCharWidth =
        (prev.width / Math.max(1, prev.str.length) + it.width / Math.max(1, it.str.length)) / 2;
      text += gap > avgCharWidth * 2.5 + 1 ? "  |  " : " ";
    }
    text += it.str;
  }
  return text;
}

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
    const text = buildLineText(ordered);
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
