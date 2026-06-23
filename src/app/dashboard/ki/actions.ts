"use server";

import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { TOOLS, runTool } from "@/lib/ai-tools";

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export interface AskResult {
  answer: string;
  error?: string;
}

function systemPrompt(): string {
  return [
    "Du bist der Daten-Assistent von FLOORTEC – einem Bodenleger-/Handwerksbetrieb.",
    "Beantworte Fragen zu Umsatz, Kosten, Gewinn, offenen Posten, Angeboten/Aufträgen,",
    "Mitarbeiterleistung und Lager ausschließlich auf Basis der bereitgestellten Werkzeuge.",
    "Erfinde niemals Zahlen – wenn du eine Kennzahl brauchst, rufe das passende Werkzeug auf.",
    `Das aktuelle Jahr ist ${new Date().getUTCFullYear()}; nutze es, wenn kein Jahr genannt wird.`,
    "Antworte auf Deutsch, kurz und konkret. Nenne Geldbeträge mit € und sage dazu, ob netto oder brutto.",
    "Wenn Daten fehlen oder ein Werkzeug einen Fehler liefert, sage das offen statt zu raten.",
  ].join(" ");
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

  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = history
    .filter((m) => m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }));

  try {
    for (let step = 0; step < 6; step++) {
      const res = await client.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 4096,
        system: systemPrompt(),
        thinking: { type: "adaptive" },
        tools: TOOLS,
        messages,
      });

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
    return { answer: "", error: e instanceof Error ? e.message : "Fehler bei der KI-Anfrage." };
  }
}
