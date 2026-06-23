"use client";

import { useRef, useState } from "react";
import { askData, type ChatMsg } from "@/app/dashboard/ki/actions";

interface Capability {
  icon: string;
  title: string;
  examples: string[];
}

const CAPABILITIES: Capability[] = [
  {
    icon: "📊",
    title: "Unternehmensübersicht",
    examples: [
      "Wie hoch ist der Umsatz 2026?",
      "Wie ist der Gewinn in % vom Umsatz?",
      "Zeig mir Umsatz und Belege je Monat.",
      "Was sind die größten Aufwandskonten?",
    ],
  },
  {
    icon: "🧾",
    title: "Offene Posten",
    examples: [
      "Wie viel an Rechnungen ist noch offen?",
      "Wie hoch sind die offenen Belege?",
    ],
  },
  {
    icon: "📈",
    title: "Angebote & Aufträge",
    examples: [
      "Wie hoch ist die Auftragsquote 2026?",
      "Wie ist der Verrechnungsgrad der Auftragsbestätigungen?",
    ],
  },
  {
    icon: "👷",
    title: "Mitarbeiterbewertung",
    examples: [
      "Welcher Mitarbeiter hat den meisten Gewinn erwirtschaftet?",
      "Zeig die Mitarbeiter nach Gewinn pro Stunde.",
    ],
  },
  {
    icon: "🏗️",
    title: "Projekte",
    examples: [
      "Welche Projekte sind im Minus?",
      "Welche Projekte haben gebuchte Stunden ohne Abschlagsrechnung?",
      "Was sind die profitabelsten Projekte?",
    ],
  },
  {
    icon: "📦",
    title: "Lager",
    examples: ["Wie hoch ist der Lagerausgang diese Woche?"],
  },
  {
    icon: "🧠",
    title: "Gedächtnis",
    examples: [
      "Merke dir: Mit „Abschlag\" meine ich die Abschlagsrechnung.",
      "Was hast du dir gemerkt?",
    ],
  },
];

export default function DataChat() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || pending) return;
    setError(null);
    setShowHelp(false);
    const next: ChatMsg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setPending(true);
    try {
      const res = await askData(next);
      if (res.error) {
        setError(res.error);
      } else {
        setMessages([...next, { role: "assistant", content: res.answer }]);
      }
    } catch {
      setError("Anfrage fehlgeschlagen.");
    } finally {
      setPending(false);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      });
    }
  };

  return (
    <div className="flex h-full w-full flex-col gap-3">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-gray-300 bg-white p-4"
      >
        {messages.length === 0 || showHelp ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-600">
              Das kann ich – klicke eine Frage an oder tippe selbst:
            </p>
            {CAPABILITIES.map((cap) => (
              <div key={cap.title}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {cap.icon} {cap.title}
                </p>
                <div className="flex flex-wrap gap-2">
                  {cap.examples.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => send(ex)}
                      className="rounded-full border border-gray-300 px-3 py-1.5 text-left text-xs text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((m, i) => (
              <li key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
                    m.role === "user"
                      ? "bg-brand-red text-white"
                      : "bg-gray-100 text-gray-900"
                  }`}
                >
                  {m.content}
                </div>
              </li>
            ))}
            {pending && (
              <li className="flex justify-start">
                <div className="rounded-2xl bg-gray-100 px-4 py-2 text-sm text-gray-500">
                  denkt nach …
                </div>
              </li>
            )}
          </ul>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-center gap-2"
      >
        <button
          type="button"
          onClick={() => setShowHelp((v) => !v)}
          title="Funktionen anzeigen"
          aria-label="Funktionen anzeigen"
          className={`shrink-0 rounded-md border px-2.5 py-2 text-sm transition-colors ${
            showHelp
              ? "border-brand-red/50 text-gray-900"
              : "border-gray-300 text-gray-600 hover:border-brand-red/50 hover:text-gray-900"
          }`}
        >
          ☰
        </button>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Frage eingeben …"
          disabled={pending}
          className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Senden
        </button>
      </form>
    </div>
  );
}
