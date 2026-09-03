import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { aiErrorMessage } from "./ai-error";
import { completePosition, EMPTY_AUFMASS, type AufmassData, type AufmassPosition } from "./aufmass-types";

/**
 * Handschriftliche Aufmaße auslesen. Bewusst das stärkste Modell: Handschrift,
 * Kürzel und krumme Tabellen sind für kleinere Modelle unzuverlässig.
 */
const AUFMASS_MODEL = "claude-opus-5";

/** Von Claude direkt lesbare Bildformate (alles andere bitte als JPG/PNG/PDF hochladen). */
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageMime = (typeof IMAGE_TYPES)[number];

/**
 * JSON-Schema der Antwort (structured outputs → keine Klammer-Reparatur nötig).
 * Wichtig: Die API erlaubt höchstens 16 Felder mit Union-Typen. Deshalb sind nur
 * die Zahlenfelder nullable; unbekannte Textfelder kommen als leerer String
 * zurück und werden beim Einlesen zu null.
 */
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "customer", "project", "address", "date", "measuredBy", "positions", "remarks", "transcript"],
  properties: {
    title: { type: "string", description: "Kurzer Titel, z. B. „Aufmaß Bad Müller“ (leer, wenn unbekannt)." },
    customer: { type: "string", description: "Kunde (leer, wenn nicht angegeben)." },
    project: { type: "string", description: "Projekt/Bauvorhaben, ggf. mit Nummer (leer, wenn unbekannt)." },
    address: { type: "string", description: "Adresse/Baustelle (leer, wenn unbekannt)." },
    date: { type: "string", description: "Datum des Aufmaßes als YYYY-MM-DD (leer, wenn unbekannt)." },
    measuredBy: { type: "string", description: "Wer das Aufmaß genommen hat (leer, wenn unbekannt)." },
    remarks: { type: "string", description: "Freitext-Bemerkungen vom Blatt (leer, wenn keine)." },
    transcript: {
      type: "string",
      description: "Möglichst wörtliche Abschrift des handschriftlichen Blattes, Zeile für Zeile.",
    },
    positions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["area", "description", "length", "width", "height", "count", "quantity", "unit", "note"],
        properties: {
          area: { type: "string", description: "Raum/Bereich, z. B. „Bad EG“ (leer, wenn keiner genannt)." },
          description: { type: "string", description: "Leistung/Bauteil, z. B. „Boden Fliese“." },
          length: { type: ["number", "null"], description: "Länge in Metern." },
          width: { type: ["number", "null"], description: "Breite in Metern." },
          height: { type: ["number", "null"], description: "Höhe in Metern." },
          count: { type: ["number", "null"], description: "Anzahl/Faktor gleicher Maße." },
          quantity: { type: ["number", "null"], description: "Menge, nur wenn sie auf dem Blatt steht." },
          unit: { type: "string", description: "Einheit: m², m, Stk … (leer, wenn nicht ableitbar)." },
          note: { type: "string", description: "Randnotiz zur Position (leer, wenn keine)." },
        },
      },
    },
  },
} as const;

const PROMPT =
  "Das Bild/PDF zeigt ein HANDSCHRIFTLICHES AUFMASS aus dem Baugewerbe (Bodenleger/Fliesenleger). " +
  "Lies es so genau wie möglich aus und gib die Positionen strukturiert zurück.\n\n" +
  "Regeln:\n" +
  "- Maße sind in Metern, sofern nichts anderes dabeisteht; cm-Angaben in Meter umrechnen (z. B. 240 cm = 2.4).\n" +
  "- Dezimaltrennzeichen im Original ist meist ein Komma – als Zahl mit Punkt zurückgeben.\n" +
  "- Ein Eintrag wie „2,40 x 1,80“ bedeutet length=2.4 und width=1.8.\n" +
  "- Steht eine fertige Menge/Summe auf dem Blatt, in quantity übernehmen; sonst quantity=null lassen " +
  "(die Menge wird dann aus den Maßen berechnet). Rechne NICHT selbst herum, wenn es nicht dasteht.\n" +
  "- Überschriften wie Raumnamen gehören in area und gelten für alle folgenden Zeilen bis zur nächsten Überschrift.\n" +
  "- Übliche Kürzel: „Bd“/„Bod“ = Boden, „So“/„Sockel“ = Sockelleiste, „Wd“ = Wand, „lfm“ = m, „qm“/„m2“ = m².\n" +
  "- Unsichere Stellen NICHT erfinden: unleserliche Werte auf null setzen und die Stelle in note bzw. " +
  "im transcript mit [unleserlich] kennzeichnen.\n" +
  "- transcript = möglichst wörtliche Abschrift des Blattes (Zeilen wie geschrieben), damit man gegenprüfen kann.";

/**
 * Liest ein handschriftliches Aufmaß (Foto oder PDF) aus.
 * Ergebnis ist bereits um berechnete Mengen/Einheiten ergänzt.
 */
export async function extractAufmass(file: {
  data: Buffer;
  mime: string;
}): Promise<{ ok: true; data: AufmassData } | { ok: false; error: string }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "ANTHROPIC_API_KEY fehlt – Auswertung nicht möglich." };
  }

  const isPdf = file.mime === "application/pdf";
  const isImage = (IMAGE_TYPES as readonly string[]).includes(file.mime);
  if (!isPdf && !isImage) {
    return {
      ok: false,
      error: `Dateityp ${file.mime || "unbekannt"} kann nicht gelesen werden – bitte als JPG, PNG oder PDF hochladen.`,
    };
  }

  const base64 = file.data.toString("base64");
  const block: Anthropic.ContentBlockParam = isPdf
    ? {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64 },
      }
    : {
        type: "image",
        source: { type: "base64", media_type: file.mime as ImageMime, data: base64 },
      };

  try {
    const client = new Anthropic({ maxRetries: 2, timeout: 300_000 });
    const res = await client.messages.create({
      model: AUFMASS_MODEL,
      max_tokens: 16000,
      output_config: { format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
      messages: [{ role: "user", content: [block, { type: "text", text: PROMPT }] }],
    });

    if (res.stop_reason === "refusal") {
      return { ok: false, error: "Die KI hat die Auswertung abgelehnt." };
    }

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) return { ok: false, error: "Keine Antwort von der KI erhalten." };

    const parsed = JSON.parse(text) as Partial<AufmassData>;
    const positions: AufmassPosition[] = Array.isArray(parsed.positions)
      ? parsed.positions
          .map((p) =>
            completePosition({
              area: strOrNull(p.area),
              description: strOrNull(p.description),
              length: numOrNull(p.length),
              width: numOrNull(p.width),
              height: numOrNull(p.height),
              count: numOrNull(p.count),
              quantity: numOrNull(p.quantity),
              unit: strOrNull(p.unit),
              note: strOrNull(p.note),
            })
          )
          // Komplett leere Zeilen (nur Platzhalter) nicht übernehmen.
          .filter((p) => p.description || p.quantity != null || p.area)
      : [];

    const date = strOrNull(parsed.date);
    return {
      ok: true,
      data: {
        ...EMPTY_AUFMASS,
        title: strOrNull(parsed.title),
        customer: strOrNull(parsed.customer),
        project: strOrNull(parsed.project),
        address: strOrNull(parsed.address),
        date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
        measuredBy: strOrNull(parsed.measuredBy),
        remarks: strOrNull(parsed.remarks),
        transcript: strOrNull(parsed.transcript),
        positions,
      },
    };
  } catch (e) {
    return { ok: false, error: aiErrorMessage(e, "Aufmaß konnte nicht ausgelesen werden.") };
  }
}

const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Leere/nur-Leerzeichen-Strings des Modells als „nicht vorhanden" behandeln. */
const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
