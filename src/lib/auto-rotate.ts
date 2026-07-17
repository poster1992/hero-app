import "server-only";
import { Jimp } from "jimp";
import { PDFDocument, degrees } from "pdf-lib";

/** Erlaubte Drehwinkel (Grad im Uhrzeigersinn). */
export function normalizeRotation(v: unknown): 0 | 90 | 180 | 270 {
  const n = Number(v);
  return n === 90 || n === 180 || n === 270 ? n : 0;
}

/**
 * Dreht einen Beleg-Buffer um `cwDeg` Grad IM UHRZEIGERSINN (0/90/180/270).
 * PDFs werden verlustfrei über das /Rotate-Attribut gedreht; Bilder werden neu
 * gerendert (jimp rotiert gegen den Uhrzeigersinn → Winkel invertiert). Wirft nie:
 * schlägt die Drehung fehl, kommt der Original-Buffer unverändert zurück.
 */
export async function rotateBuffer(buffer: Buffer, mime: string, cwDeg: number): Promise<Buffer> {
  const deg = (((cwDeg % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  if (deg === 0) return buffer;
  try {
    if (mime === "application/pdf") {
      const pdf = await PDFDocument.load(buffer);
      for (const page of pdf.getPages()) {
        const cur = page.getRotation().angle;
        page.setRotation(degrees(((cur + deg) % 360 + 360) % 360));
      }
      return Buffer.from(await pdf.save());
    }
    if (mime.startsWith("image/")) {
      const img = await Jimp.read(buffer);
      // jimp.rotate() dreht gegen den Uhrzeigersinn → für CW den Gegenwinkel nehmen.
      img.rotate((360 - deg) % 360);
      const outMime = mime === "image/png" ? "image/png" : "image/jpeg";
      return Buffer.from(await img.getBuffer(outMime));
    }
  } catch {
    // Drehung fehlgeschlagen → Original unverändert behalten.
  }
  return buffer;
}
