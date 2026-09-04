import "server-only";
import ExcelJS from "exceljs";
import { sumByUnit, type AufmassData, type AufmassPosition } from "./aufmass-types";

/** Datum yyyy-mm-dd → dd.mm.yyyy. */
const d = (iso: string | null): string => {
  if (!iso) return "";
  const [y, m, day] = iso.split("-");
  return day ? `${day}.${m}.${y}` : iso;
};

// Gleiche Spaltenaufteilung wie im Word-Export (aufmass-docx.ts) – der Bereich
// steht als eigene Überschriftszeile über seinen Positionen.
const HEADERS = ["Beschreibung", "L (m)", "B (m)", "H (m)", "Anz.", "Menge", "Einh.", "Bemerkung"];
const COL_WIDTHS = [36, 9, 9, 9, 7, 11, 9, 24];
const COLS = HEADERS.length;

// Farben/Linien passend zum hellen „Datenblatt"-Design der App.
const FILL_HEADER: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E7E7" } };
const FILL_AREA: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
const FILL_TOTAL: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E7E7" } };
const FILL_LABEL: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
const HAIRLINE: ExcelJS.Border = { style: "hair", color: { argb: "FFDBDBD6" } };
const HEADER_RULE: ExcelJS.Border = { style: "medium", color: { argb: "FF17181A" } };
const BRAND_RED = "FFE8392A";
const NUM_FMT = "0.00";

/** Zahlenspalten rechtsbündig, wie im Word-Export. */
const RIGHT_FROM = 1;
const RIGHT_TO = 6;

/**
 * Baut das Aufmaß als Excel-Arbeitsmappe – dieselben Inhalte wie das Word-Dokument
 * (Kopfdaten, Positionstabelle je Bereich, Gesamtsummen, Bemerkungen, Abschrift),
 * aber als Tabelle mit echten Zahlen zum direkten Weiterrechnen/Filtern.
 */
export async function buildAufmassXlsx(
  data: AufmassData,
  meta: { sourceFileName: string | null; createdByName: string | null }
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FLOORTEC Hero-App";
  wb.created = new Date();
  const ws = wb.addWorksheet("Aufmaß", {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });
  ws.columns = COL_WIDTHS.map((width) => ({ width }));

  let row = 1;

  // Titel + Untertitel
  ws.mergeCells(row, 1, row, COLS);
  const title = ws.getCell(row, 1);
  title.value = "AUFMASS";
  title.font = { bold: true, size: 18 };
  ws.getRow(row).border = { bottom: { style: "medium", color: { argb: BRAND_RED } } };
  row += 1;

  ws.mergeCells(row, 1, row, COLS);
  const subtitle = ws.getCell(row, 1);
  subtitle.value =
    "Automatisch aus dem handschriftlichen Aufmaß erzeugt" +
    (meta.sourceFileName ? ` (${meta.sourceFileName})` : "") +
    " – bitte prüfen.";
  subtitle.font = { italic: true, size: 9, color: { argb: "FF808080" } };
  row += 2;

  // Kopfdaten
  const metaRows: [string, string | null][] = [
    ["Kunde", data.customer],
    ["Projekt / Bauvorhaben", data.project],
    ["Adresse", data.address],
    ["Datum", d(data.date) || null],
    ["Aufmaß genommen von", data.measuredBy],
    ["Erfasst durch", meta.createdByName],
  ];
  for (const [label, value] of metaRows) {
    const labelCell = ws.getCell(row, 1);
    labelCell.value = label;
    labelCell.font = { bold: true };
    labelCell.fill = FILL_LABEL;
    labelCell.border = { bottom: HAIRLINE };
    ws.mergeCells(row, 2, row, COLS);
    const valueCell = ws.getCell(row, 2);
    valueCell.value = value && value.trim() ? value : "";
    valueCell.border = { bottom: HAIRLINE };
    row += 1;
  }
  row += 1;

  // Positionen-Überschrift
  const posHeading = ws.getCell(row, 1);
  posHeading.value = "Positionen";
  posHeading.font = { bold: true, size: 13 };
  row += 1;

  // Tabellenkopf
  const headerRowNum = row;
  HEADERS.forEach((h, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = h;
    c.font = { bold: true };
    c.fill = FILL_HEADER;
    c.border = { bottom: HEADER_RULE };
    c.alignment = { horizontal: i >= RIGHT_FROM && i <= RIGHT_TO ? "right" : "left" };
  });
  row += 1;
  ws.views = [{ state: "frozen", ySplit: headerRowNum, showGridLines: false }];

  // Positionen nach Bereich gruppieren, Reihenfolge des Originals beibehalten.
  const groups: { area: string; items: AufmassPosition[] }[] = [];
  for (const p of data.positions) {
    const area = (p.area ?? "").trim() || "Ohne Bereich";
    const last = groups[groups.length - 1];
    if (last && last.area === area) last.items.push(p);
    else groups.push({ area, items: [p] });
  }

  for (const g of groups) {
    ws.mergeCells(row, 1, row, COLS);
    const areaCell = ws.getCell(row, 1);
    areaCell.value = g.area;
    areaCell.font = { bold: true };
    areaCell.fill = FILL_AREA;
    row += 1;

    for (const p of g.items) {
      const values: (string | number | null)[] = [
        p.description ?? "",
        p.length,
        p.width,
        p.height,
        p.count,
        p.quantity,
        p.unit ?? "",
        p.note ?? "",
      ];
      values.forEach((v, i) => {
        const c = ws.getCell(row, i + 1);
        c.value = v ?? "";
        c.border = { bottom: HAIRLINE };
        if (i >= RIGHT_FROM && i <= RIGHT_TO && i !== 6) {
          c.alignment = { horizontal: "right" };
          // Anz. (Index 4) ist meist ganzzahlig – keine erzwungenen Nullen anhängen.
          if (typeof v === "number") c.numFmt = i === 4 ? "0.##" : NUM_FMT;
        } else if (i === 6) {
          c.alignment = { horizontal: "right" };
        }
      });
      row += 1;
    }
  }

  // Gesamtsumme je Einheit (keine Zwischensummen je Bereich, siehe Word-Export).
  for (const s of sumByUnit(data.positions)) {
    ws.mergeCells(row, 1, row, 5);
    const labelCell = ws.getCell(row, 1);
    labelCell.value = "Gesamt";
    labelCell.font = { bold: true };
    labelCell.fill = FILL_TOTAL;
    labelCell.alignment = { horizontal: "right" };
    const qtyCell = ws.getCell(row, 6);
    qtyCell.value = s.total;
    qtyCell.numFmt = NUM_FMT;
    qtyCell.font = { bold: true };
    qtyCell.fill = FILL_TOTAL;
    qtyCell.alignment = { horizontal: "right" };
    const unitCell = ws.getCell(row, 7);
    unitCell.value = s.unit;
    unitCell.font = { bold: true };
    unitCell.fill = FILL_TOTAL;
    const noteCell = ws.getCell(row, 8);
    noteCell.value = "";
    noteCell.fill = FILL_TOTAL;
    row += 1;
  }

  if (data.remarks) {
    row += 1;
    const heading = ws.getCell(row, 1);
    heading.value = "Bemerkungen";
    heading.font = { bold: true, size: 13 };
    row += 1;
    ws.mergeCells(row, 1, row, COLS);
    const cell = ws.getCell(row, 1);
    cell.value = data.remarks;
    cell.alignment = { wrapText: true, vertical: "top" };
    ws.getRow(row).height = Math.max(18, Math.ceil(data.remarks.length / 90) * 15);
    row += 1;
  }

  if (data.transcript) {
    row += 2;
    const heading = ws.getCell(row, 1);
    heading.value = "Abschrift des Originals";
    heading.font = { bold: true, size: 13 };
    row += 1;
    const note = ws.getCell(row, 1);
    note.value = "Wörtliche Abschrift des handschriftlichen Blattes – nur zur Kontrolle.";
    note.font = { italic: true, size: 9, color: { argb: "FF808080" } };
    row += 1;
    for (const line of data.transcript.split(/\r?\n/)) {
      ws.mergeCells(row, 1, row, COLS);
      const c = ws.getCell(row, 1);
      c.value = line || " ";
      c.font = { name: "Consolas", size: 9 };
      row += 1;
    }
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** Dateiname der Excel-Datei: „Aufmass_<Kunde>_<Datum>.xlsx" (dateisystem-sicher). */
export function aufmassXlsxFileName(data: AufmassData): string {
  const clean = (s: string | null) =>
    (s ?? "")
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 40);
  const parts = ["Aufmass", clean(data.customer) || clean(data.project) || clean(data.title), data.date ?? ""].filter(
    Boolean
  );
  return `${parts.join("_")}.xlsx`;
}
