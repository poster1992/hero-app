import "server-only";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { sumByUnit, type AufmassData, type AufmassPosition } from "./aufmass-types";

/** Zahl deutsch formatieren (Komma, max. 2 Nachkommastellen), null → „". */
const n = (v: number | null | undefined): string =>
  v == null ? "" : v.toLocaleString("de-DE", { maximumFractionDigits: 2 });

/** Datum yyyy-mm-dd → dd.mm.yyyy. */
const d = (iso: string | null): string => {
  if (!iso) return "";
  const [y, m, day] = iso.split("-");
  return day ? `${day}.${m}.${y}` : iso;
};

// Der Bereich steht als eigene Überschriftszeile über seinen Positionen,
// deshalb hat die Tabelle selbst keine Bereichs-Spalte.
const HEADERS = ["Beschreibung", "L (m)", "B (m)", "H (m)", "Anz.", "Menge", "Einh.", "Bemerkung"];
const WIDTHS = [30, 9, 9, 9, 7, 11, 8, 17];
/** Spalten, die rechtsbündig stehen (alle Zahlenspalten + Einheit). */
const RIGHT_FROM = 1;
const RIGHT_TO = 6;

// Statt eines vollen Gitternetzes nur dezente Trennlinien: kein Rahmen um/zwischen
// den Spalten, nur eine feine Zeile zwischen den Positionen und eine kräftigere
// unter der Kopfzeile – wirkt aufgeräumter, bleibt aber lesbar gegliedert.
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const TABLE_NO_BORDERS = {
  top: NO_BORDER,
  bottom: NO_BORDER,
  left: NO_BORDER,
  right: NO_BORDER,
  insideHorizontal: NO_BORDER,
  insideVertical: NO_BORDER,
};
const HAIRLINE = { style: BorderStyle.SINGLE, size: 4, color: "DBDBD6" };
const HEADER_RULE = { style: BorderStyle.SINGLE, size: 8, color: "17181A" };
const CELL_MARGINS = { top: 60, bottom: 60, left: 80, right: 80 };

function cell(
  text: string,
  opts: {
    bold?: boolean;
    right?: boolean;
    fill?: string;
    width?: number;
    span?: number;
    rule?: "hairline" | "header";
  } = {}
) {
  const bottom = opts.rule === "header" ? HEADER_RULE : opts.rule === "hairline" ? HAIRLINE : undefined;
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    columnSpan: opts.span,
    shading: opts.fill ? { fill: opts.fill } : undefined,
    margins: CELL_MARGINS,
    borders: bottom ? { bottom } : undefined,
    children: [
      new Paragraph({
        alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [new TextRun({ text, bold: opts.bold, size: 20 })],
      }),
    ],
  });
}

/** Kopfzeile der Positionstabelle. */
function headerRow(): TableRow {
  return new TableRow({
    tableHeader: true,
    children: HEADERS.map((h, i) =>
      cell(h, {
        bold: true,
        fill: "E7E7E7",
        width: WIDTHS[i],
        right: i >= RIGHT_FROM && i <= RIGHT_TO,
        rule: "header",
      })
    ),
  });
}

/** Eine Positionszeile. */
function positionRow(p: AufmassPosition): TableRow {
  const values = [
    p.description ?? "",
    n(p.length),
    n(p.width),
    n(p.height),
    n(p.count),
    n(p.quantity),
    p.unit ?? "",
    p.note ?? "",
  ];
  return new TableRow({
    children: values.map((v, i) =>
      cell(v, { width: WIDTHS[i], right: i >= RIGHT_FROM && i <= RIGHT_TO, rule: "hairline" })
    ),
  });
}

/** Zwischen-/Gesamtsumme als eigene Zeile (je Einheit eine Zeile). */
function sumRow(label: string, total: number, unit: string, fill: string): TableRow {
  // Label über die ersten fünf Spalten, dann Menge/Einheit/Bemerkung.
  const labelWidth = WIDTHS.slice(0, 5).reduce((s, w) => s + w, 0);
  return new TableRow({
    children: [
      cell(label, { bold: true, right: true, fill, width: labelWidth, span: 5 }),
      cell(n(total), { bold: true, right: true, fill, width: WIDTHS[5] }),
      cell(unit, { bold: true, right: true, fill, width: WIDTHS[6] }),
      cell("", { fill, width: WIDTHS[7] }),
    ],
  });
}

/** Zeile im Kopfbereich (Bezeichnung + Wert), leere Werte als Linie zum Ausfüllen. */
function metaRow(label: string, value: string | null): TableRow {
  return new TableRow({
    children: [
      cell(label, { bold: true, width: 25, fill: "F5F5F5", rule: "hairline" }),
      cell(value && value.trim() ? value : "_______________________________", { width: 75, rule: "hairline" }),
    ],
  });
}

/**
 * Baut das bearbeitbare Word-Dokument zum Aufmaß:
 * Kopfdaten, Positionstabelle je Bereich mit Zwischensummen, Gesamtsummen,
 * Bemerkungen und zum Schluss die Abschrift des handschriftlichen Originals.
 */
export async function buildAufmassDocx(
  data: AufmassData,
  meta: { sourceFileName: string | null; createdByName: string | null }
): Promise<Buffer> {
  // Positionen nach Bereich gruppieren, Reihenfolge des Originals beibehalten.
  const groups: { area: string; items: AufmassPosition[] }[] = [];
  for (const p of data.positions) {
    const area = (p.area ?? "").trim() || "Ohne Bereich";
    const last = groups[groups.length - 1];
    if (last && last.area === area) last.items.push(p);
    else groups.push({ area, items: [p] });
  }

  const rows: TableRow[] = [headerRow()];
  for (const g of groups) {
    // Bereichs-Überschrift als eigene Zeile (durchgehend grau).
    rows.push(
      new TableRow({
        children: [cell(g.area, { bold: true, fill: "D9D9D9", width: 100, span: HEADERS.length })],
      })
    );
    for (const p of g.items) rows.push(positionRow(p));
    for (const s of sumByUnit(g.items)) {
      rows.push(sumRow(`Zwischensumme ${g.area}`, s.total, s.unit, "F2F2F2"));
    }
  }
  for (const s of sumByUnit(data.positions)) {
    rows.push(sumRow("Gesamt", s.total, s.unit, "E7E7E7"));
  }

  const heading = (text: string) =>
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 120 },
      children: [new TextRun({ text, bold: true })],
    });

  const doc = new Document({
    creator: "FLOORTEC Hero-App",
    title: data.title ?? "Aufmaß",
    description: "Automatisch aus einem handschriftlichen Aufmaß erzeugt",
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun({ text: "AUFMASS", bold: true })],
          }),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({
                text:
                  "Automatisch aus dem handschriftlichen Aufmaß erzeugt" +
                  (meta.sourceFileName ? ` (${meta.sourceFileName})` : "") +
                  " – bitte prüfen und bei Bedarf direkt hier korrigieren.",
                italics: true,
                size: 18,
                color: "808080",
              }),
            ],
          }),

          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: TABLE_NO_BORDERS,
            rows: [
              metaRow("Kunde", data.customer),
              metaRow("Projekt / Bauvorhaben", data.project),
              metaRow("Adresse", data.address),
              metaRow("Datum", d(data.date)),
              metaRow("Aufmaß genommen von", data.measuredBy),
              metaRow("Erfasst durch", meta.createdByName),
            ],
          }),

          heading("Positionen"),
          new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: TABLE_NO_BORDERS, rows }),

          ...(data.remarks
            ? [heading("Bemerkungen"), new Paragraph({ children: [new TextRun({ text: data.remarks, size: 20 })] })]
            : []),

          ...(data.transcript
            ? [
                new Paragraph({ children: [new PageBreak()] }),
                heading("Abschrift des Originals"),
                new Paragraph({
                  spacing: { after: 120 },
                  children: [
                    new TextRun({
                      text: "Wörtliche Abschrift des handschriftlichen Blattes – nur zur Kontrolle.",
                      italics: true,
                      size: 18,
                      color: "808080",
                    }),
                  ],
                }),
                ...data.transcript.split(/\r?\n/).map(
                  (line) =>
                    new Paragraph({
                      children: [new TextRun({ text: line || " ", font: "Consolas", size: 18 })],
                    })
                ),
              ]
            : []),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

/** Dateiname des Word-Dokuments: „Aufmass_<Kunde>_<Datum>.docx" (dateisystem-sicher). */
export function aufmassDocxFileName(data: AufmassData): string {
  const clean = (s: string | null) =>
    (s ?? "")
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 40);
  const parts = ["Aufmass", clean(data.customer) || clean(data.project) || clean(data.title), data.date ?? ""].filter(
    Boolean
  );
  return `${parts.join("_")}.docx`;
}
