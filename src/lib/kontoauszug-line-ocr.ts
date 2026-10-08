import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { aiErrorMessage } from "./ai-error";

const OCR_MODEL = "claude-haiku-4-5";

/**
 * Liest Betrag (und, falls im Ausschnitt sichtbar, das Buchungsdatum) aus
 * einem kleinen Bildausschnitt (vom Nutzer per Maus gezogenes Rechteck um
 * eine einzelne Kontoauszug-Zeile) per KI aus – zum Vorausfüllen des
 * Betrags-/Datumsfelds beim manuellen Markieren einer Zeile. Bleibt bewusst
 * manuell korrigierbar (kein automatisches Zuordnen/Buchen wie beim früher
 * entfernten "Kontoauszug einlesen").
 */
export async function extractLineAmount(
  imageBase64Png: string
): Promise<{ amount: number | null; date: string | null; error?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { amount: null, date: null, error: "ANTHROPIC_API_KEY fehlt." };
  try {
    const client = new Anthropic({ maxRetries: 2, timeout: 30_000 });
    const res = await client.messages.create({
      model: OCR_MODEL,
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: imageBase64Png } },
            {
              type: "text",
              text:
                "Dies ist ein Ausschnitt aus einer einzelnen Buchungszeile eines Bankkontoauszugs. " +
                "Lies den Betrag dieser Zeile in Euro aus (Beträge in Auszügen stehen oft bereits negativ bei " +
                "Abbuchungen – gib trotzdem den Betrag ohne Vorzeichen zurück). Falls ein Datum (Buchungsdatum) " +
                "im Ausschnitt sichtbar ist, lies auch das aus. Antworte AUSSCHLIESSLICH mit JSON: " +
                '{"amount": number|null, "date": string|null}. amount = Betrag als Zahl (Punkt als Dezimaltrenner, ' +
                "ohne Währungszeichen, immer positiv) oder null, falls kein eindeutiger Betrag erkennbar ist. " +
                "date = Datum im Format YYYY-MM-DD oder null, falls keines sichtbar/eindeutig ist. Nur JSON, keine Erklärungen.",
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
    const jsonStr = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const parsed = JSON.parse(jsonStr) as { amount?: unknown; date?: unknown };
    const amt = typeof parsed.amount === "number" ? parsed.amount : Number(parsed.amount);
    const amount = Number.isFinite(amt) && amt > 0 ? Math.round(Math.abs(amt) * 100) / 100 : null;
    const date = typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null;
    return { amount, date };
  } catch (e) {
    return { amount: null, date: null, error: aiErrorMessage(e, "Betrag konnte nicht erkannt werden.") };
  }
}
