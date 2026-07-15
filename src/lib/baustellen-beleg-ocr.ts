import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getBaustellenBelegRaw, setBaustellenBelegOcr } from "./baustellen-belege";
import { aiErrorMessage } from "./ai-error";

const OCR_MODEL = "claude-haiku-4-5";

/**
 * Eigenständige OCR über einen hochgeladenen Baustellen-Beleg.
 * Greift ausschließlich auf die lokal gespeicherte Datei zu – KEINE HERO-Daten,
 * KEINE Verbindung zum HERO-Beleg-OCR-Index. Ergebnis liegt nur am Beleg selbst.
 */
export async function ocrBaustellenBeleg(id: number): Promise<{ ok: boolean; error?: string }> {
  const EMPTY = { supplier: null, amount: null, date: null, text: null };
  if (!process.env.ANTHROPIC_API_KEY) {
    await setBaustellenBelegOcr(id, "error", EMPTY);
    return { ok: false, error: "ANTHROPIC_API_KEY fehlt." };
  }
  const raw = await getBaustellenBelegRaw(id);
  if (!raw) {
    await setBaustellenBelegOcr(id, "error", EMPTY);
    return { ok: false, error: "Datei nicht gefunden." };
  }

  const isImage = raw.mime.startsWith("image/");
  const isPdf = raw.mime === "application/pdf";
  if (!isImage && !isPdf) {
    // Nur PDF/Bild sind per OCR lesbar – andere Dateitypen ohne Text markieren.
    await setBaustellenBelegOcr(id, "done", EMPTY);
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
                "Dies ist ein hochgeladener Beleg/Rechnung. Antworte AUSSCHLIESSLICH mit JSON: " +
                '{"supplier":string|null,"amount":number|null,"date":string|null,"text":string}. ' +
                "supplier = Lieferant/Firmenname des Ausstellers (kurz, ohne Rechtsform-Zusätze wenn möglich). " +
                "amount = Gesamt-/Endbetrag BRUTTO in Euro als Zahl (Punkt als Dezimaltrenner, ohne Währungszeichen). " +
                "date = Belegdatum im Format YYYY-MM-DD oder null. " +
                "text = der GESAMTE lesbare Text des Belegs als Fließtext (für die Volltextsuche). " +
                "Nur JSON, keine Erklärungen.",
            },
          ],
        },
      ],
    });
    const raw = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    let supplier: string | null = null;
    let amount: number | null = null;
    let date: string | null = null;
    let text: string | null = raw || null;
    try {
      const jsonStr = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
      const parsed = JSON.parse(jsonStr) as {
        supplier?: unknown;
        amount?: unknown;
        date?: unknown;
        text?: unknown;
      };
      supplier = typeof parsed.supplier === "string" && parsed.supplier.trim() ? parsed.supplier.trim().slice(0, 255) : null;
      const amt = typeof parsed.amount === "number" ? parsed.amount : Number(parsed.amount);
      amount = Number.isFinite(amt) && amt > 0 ? Math.round(amt * 100) / 100 : null;
      date = typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null;
      text = typeof parsed.text === "string" && parsed.text.trim() ? parsed.text.trim() : null;
    } catch {
      // Kein sauberes JSON – wenigstens den Rohtext als Volltext behalten.
    }

    await setBaustellenBelegOcr(id, "done", { supplier, amount, date, text });
    return { ok: true };
  } catch (e) {
    await setBaustellenBelegOcr(id, "error", { supplier: null, amount: null, date: null, text: null });
    return { ok: false, error: aiErrorMessage(e, "OCR fehlgeschlagen.") };
  }
}
