import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getBaustellenBelegRaw, setBaustellenBelegOcr } from "./baustellen-belege";

const OCR_MODEL = "claude-haiku-4-5";

/**
 * Eigenständige OCR über einen hochgeladenen Baustellen-Beleg.
 * Greift ausschließlich auf die lokal gespeicherte Datei zu – KEINE HERO-Daten,
 * KEINE Verbindung zum HERO-Beleg-OCR-Index. Ergebnis liegt nur am Beleg selbst.
 */
export async function ocrBaustellenBeleg(id: number): Promise<{ ok: boolean; error?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    await setBaustellenBelegOcr(id, "error", null);
    return { ok: false, error: "ANTHROPIC_API_KEY fehlt." };
  }
  const raw = await getBaustellenBelegRaw(id);
  if (!raw) {
    await setBaustellenBelegOcr(id, "error", null);
    return { ok: false, error: "Datei nicht gefunden." };
  }

  const isImage = raw.mime.startsWith("image/");
  const isPdf = raw.mime === "application/pdf";
  if (!isImage && !isPdf) {
    // Nur PDF/Bild sind per OCR lesbar – andere Dateitypen ohne Text markieren.
    await setBaustellenBelegOcr(id, "done", null);
    return { ok: true };
  }

  const block = isImage
    ? {
        type: "image" as const,
        source: { type: "base64" as const, media_type: raw.mime as "image/png", data: raw.data },
      }
    : {
        type: "document" as const,
        source: { type: "base64" as const, media_type: "application/pdf" as const, data: raw.data },
      };

  try {
    const client = new Anthropic({ maxRetries: 2, timeout: 120_000 });
    const res = await client.messages.create({
      model: OCR_MODEL,
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: [
            block,
            {
              type: "text",
              text:
                "Dies ist ein hochgeladener Beleg/Dokument. Gib den GESAMTEN lesbaren Text als " +
                "reinen Fließtext wieder (OCR). Keine Erklärungen, kein Markdown, keine Kommentare – " +
                "nur der erkannte Text, Zeile für Zeile.",
            },
          ],
        },
      ],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    await setBaustellenBelegOcr(id, "done", text || null);
    return { ok: true };
  } catch (e) {
    await setBaustellenBelegOcr(id, "error", null);
    return { ok: false, error: e instanceof Error ? e.message : "OCR fehlgeschlagen." };
  }
}
