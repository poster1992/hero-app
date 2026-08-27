// Erzeugt public/anleitung-belege-hochladen.pdf (Mitarbeiter-Anleitung).
// Aufruf:  node scripts/gen-anleitung-belege.mjs
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFileSync } from "node:fs";

const RED = rgb(0.909, 0.223, 0.164); // #E8392A
const INK = rgb(0.09, 0.094, 0.102);
const MUTED = rgb(0.37, 0.4, 0.43);
const LINE = rgb(0.86, 0.86, 0.84);
const PAPER = rgb(0.945, 0.945, 0.93);

const A4 = [595.28, 841.89];
const M = 48; // Rand

const doc = await PDFDocument.create();
const page = doc.addPage(A4);
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const W = A4[0];

let y = A4[1];

// --- Kopf (roter Balken) ---
const headH = 92;
page.drawRectangle({ x: 0, y: A4[1] - headH, width: W, height: headH, color: RED });
page.drawText("FLOORTEC", { x: M, y: A4[1] - 46, size: 26, font: bold, color: rgb(1, 1, 1) });
page.drawText("Anleitung: Belege hochladen", { x: M, y: A4[1] - 72, size: 13, font, color: rgb(1, 1, 1) });
y = A4[1] - headH - 28;

function wrap(text, f, size, maxW) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (f.widthOfTextAtSize(t, size) > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function paragraph(text, x, size, f, color, maxW, lh) {
  for (const line of wrap(text, f, size, maxW)) {
    page.drawText(line, { x, y, size, font: f, color });
    y -= lh;
  }
}

// --- Intro ---
paragraph(
  "So laedst du Rechnungen/Belege in wenigen Schritten hoch. Fotos oder PDFs genuegen - der Rest passiert automatisch.",
  M,
  11,
  font,
  MUTED,
  W - 2 * M,
  15
);
y -= 12;

// --- Schritte ---
const steps = [
  [
    "Menue oeffnen",
    "In der Seitenleiste unter \"Cockpit\" auf \"Posteingang (Sammel-Upload)\" tippen.",
  ],
  [
    "Belege auswaehlen",
    "Auf die Flaeche tippen und Dateien waehlen - oder Dateien einfach per Drag & Drop hineinziehen. Erlaubt sind PDF oder Fotos (JPG, PNG, HEIC) der Rechnung.",
  ],
  [
    "Mehrere auf einmal",
    "Du kannst beliebig viele Belege gleichzeitig hochladen. Mehrseitige Rechnungen am besten als ein einziges PDF.",
  ],
  [
    "Upload laeuft im Hintergrund",
    "Ein Fortschrittsbalken zeigt den Status. Du kannst weiterarbeiten oder die App schliessen - der Upload laeuft trotzdem zu Ende.",
  ],
  [
    "Automatische Erkennung",
    "Betrag, Lieferant, Datum und Konto werden automatisch ausgelesen. In der Regel musst du nichts weiter eintragen.",
  ],
  [
    "Fertig",
    "Die erfassten Belege erscheinen anschliessend in der Belegliste und gehen in die Pruefung. Du bist fertig.",
  ],
];

const numX = M;
const textX = M + 34;
const textW = W - textX - M;

steps.forEach(([title, desc], i) => {
  // Nummernkreis
  const cy = y - 4;
  page.drawCircle({ x: numX + 11, y: cy, size: 12, color: RED });
  const nStr = String(i + 1);
  const nW = bold.widthOfTextAtSize(nStr, 12);
  page.drawText(nStr, { x: numX + 11 - nW / 2, y: cy - 4, size: 12, font: bold, color: rgb(1, 1, 1) });
  // Titel
  page.drawText(title, { x: textX, y: y - 1, size: 12.5, font: bold, color: INK });
  y -= 18;
  // Beschreibung
  paragraph(desc, textX, 10.5, font, MUTED, textW, 14);
  y -= 12;
});

// --- Tipps-Box ---
y -= 4;
const tips = [
  "Ganze Rechnung im Bild, gut lesbar - nicht schief oder verschwommen.",
  "Ein Beleg pro Datei; mehrseitige Rechnung als ein PDF.",
  "Keine Loehne oder vertraulichen Dokumente hier hochladen.",
];
const boxPad = 14;
const tipLines = tips.length;
const boxH = boxPad * 2 + 22 + tipLines * 15;
page.drawRectangle({
  x: M,
  y: y - boxH,
  width: W - 2 * M,
  height: boxH,
  color: PAPER,
  borderColor: LINE,
  borderWidth: 1,
});
let ty = y - boxPad - 12;
page.drawText("Tipps fuer gute Belege", { x: M + boxPad, y: ty, size: 12, font: bold, color: RED });
ty -= 22;
for (const t of tips) {
  page.drawText("-", { x: M + boxPad, y: ty, size: 10.5, font: bold, color: INK });
  page.drawText(t, { x: M + boxPad + 12, y: ty, size: 10.5, font, color: INK });
  ty -= 15;
}
y = y - boxH - 24;

// --- Fuss ---
page.drawText("FLOORTEC S.a r.l.  -  Bei Fragen: Buero / Pascal", {
  x: M,
  y: 40,
  size: 9,
  font,
  color: MUTED,
});

const bytes = await doc.save();
writeFileSync("public/anleitung-belege-hochladen.pdf", bytes);
console.log("OK -> public/anleitung-belege-hochladen.pdf (" + bytes.length + " Bytes)");
