"use server";

import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { TOOLS, runTool } from "@/lib/ai-tools";
import { listMemories, type MemoryItem } from "@/lib/ai-memory";
import { isCreditError, AI_CREDIT_MESSAGE } from "@/lib/ai-error";

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export interface AskResult {
  answer: string;
  error?: string;
}

// Standardmodell Haiku (günstig); Fallback bei Überlast: Haiku → Sonnet → Opus.
const MODELS: { model: string; thinking: boolean }[] = [
  { model: "claude-haiku-4-5", thinking: false },
  { model: "claude-sonnet-4-6", thinking: true },
  { model: "claude-opus-4-8", thinking: true },
];

function isTransient(e: unknown): boolean {
  return (
    e instanceof Anthropic.APIError &&
    (e.status === 529 || e.status === 429 || (e.status ?? 0) >= 500)
  );
}

/** Erzeugt eine Antwort und weicht bei Überlast auf das nächste Modell aus. */
async function createWithFallback(
  client: Anthropic,
  base: Omit<Anthropic.MessageCreateParamsNonStreaming, "model" | "thinking">,
  startIdx: number
): Promise<{ res: Anthropic.Message; idx: number }> {
  let lastErr: unknown;
  for (let i = startIdx; i < MODELS.length; i++) {
    const cfg = MODELS[i];
    try {
      const res = await client.messages.create({
        ...base,
        model: cfg.model,
        ...(cfg.thinking ? { thinking: { type: "adaptive" } } : {}),
      });
      return { res, idx: i };
    } catch (e) {
      if (isTransient(e)) {
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

function systemPrompt(memories: MemoryItem[]): string {
  const base = [
    "Du bist der Daten-Assistent von FLOORTEC – einem Bodenleger-/Handwerksbetrieb.",
    "Beantworte Fragen zu Umsatz, Kosten, Gewinn, offenen Posten, Angeboten/Aufträgen,",
    "Mitarbeiterleistung, Lager sowie Belegen einzelner Lieferanten ausschließlich auf Basis der bereitgestellten Werkzeuge.",
    "Erfinde niemals Zahlen – wenn du eine Kennzahl brauchst, rufe das passende Werkzeug auf.",
    `Das aktuelle Jahr ist ${new Date().getUTCFullYear()}; nutze es, wenn kein Jahr genannt wird.`,
    "Antworte auf Deutsch, kurz und konkret. Nenne Geldbeträge mit € und sage dazu, ob netto oder brutto.",
    "Wenn Daten fehlen oder ein Werkzeug einen Fehler liefert, sage das offen statt zu raten.",
    "Gedächtnis: Wenn der Nutzer dir etwas dauerhaft beibringt (Begriff, Definition, Regel, Vorliebe)",
    "oder dich bittet, dir etwas zu merken, speichere es mit dem Werkzeug 'notiz_speichern'.",
    "Beachte die unten gemerkten Notizen bei deinen Antworten. Veraltete/falsche Notizen kannst du mit 'notiz_loeschen' entfernen.",
  ].join(" ");

  if (memories.length === 0) return base;
  const notes = memories.map((m) => `- [#${m.id}] ${m.content}`).join("\n");
  return `${base}\n\nGemerktes Wissen (vom Nutzer beigebracht – beachten):\n${notes}`;
}

/** Runs one assistant turn with tool use over the existing data layer. */
export async function askData(history: ChatMsg[]): Promise<AskResult> {
  const session = await getSession();
  if (!session) return { answer: "", error: "Nicht angemeldet." };
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      answer: "",
      error: "KI ist nicht konfiguriert: ANTHROPIC_API_KEY fehlt in der .env.",
    };
  }

  const client = new Anthropic({ maxRetries: 2, timeout: 120_000 });
  const messages: Anthropic.MessageParam[] = history
    .filter((m) => m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }));

  let memories: MemoryItem[] = [];
  try {
    memories = await listMemories();
  } catch {
    // Gedächtnis optional – ohne es funktioniert der Chat trotzdem.
  }
  const system = systemPrompt(memories);

  let modelIdx = 0;
  try {
    for (let step = 0; step < 6; step++) {
      const { res, idx } = await createWithFallback(
        client,
        { max_tokens: 4096, system, tools: TOOLS, messages },
        modelIdx
      );
      modelIdx = idx; // bei Überlast gewähltes Ersatzmodell für den Rest des Gesprächs behalten

      if (res.stop_reason === "tool_use") {
        // Vollständigen Inhalt (inkl. Thinking-Blöcke) zurückgeben – für adaptives Denken nötig.
        messages.push({ role: "assistant", content: res.content });
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of res.content) {
          if (block.type === "tool_use") {
            let out: unknown;
            try {
              out = await runTool(block.name, (block.input ?? {}) as Record<string, unknown>);
            } catch (e) {
              out = { error: e instanceof Error ? e.message : "Werkzeug-Fehler" };
            }
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(out),
            });
          }
        }
        messages.push({ role: "user", content: toolResults });
        continue;
      }

      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { answer: text || "(keine Antwort)" };
    }
    return { answer: "", error: "Zu viele Schritte – bitte die Frage konkretisieren." };
  } catch (e) {
    if (isCreditError(e)) return { answer: "", error: AI_CREDIT_MESSAGE };
    if (e instanceof Anthropic.APIError) {
      if (e.status === 529 || e.status === 429) {
        return {
          answer: "",
          error: "Der KI-Dienst ist gerade überlastet. Bitte in ein paar Sekunden noch einmal fragen.",
        };
      }
      if (e.status === 401) {
        return { answer: "", error: "KI-Zugang ungültig: API-Key prüfen (ANTHROPIC_API_KEY)." };
      }
      if (e.status && e.status >= 500) {
        return { answer: "", error: "KI-Dienst vorübergehend nicht erreichbar. Bitte erneut versuchen." };
      }
    }
    return { answer: "", error: e instanceof Error ? e.message : "Fehler bei der KI-Anfrage." };
  }
}
