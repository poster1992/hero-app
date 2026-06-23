"use client";

import { useState } from "react";
import DataChat from "@/components/DataChat";

/** Schwebender KI-Assistent: Button unten rechts öffnet ein Pop-up, das die App nicht blockiert. */
export default function DataChatWidget() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-5 z-40 flex h-[70vh] max-h-[640px] w-[min(420px,calc(100vw-2.5rem))] flex-col rounded-xl border border-gray-300 bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <span className="text-sm font-semibold text-gray-900">KI-Assistent</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-gray-400 transition-colors hover:text-gray-700"
              aria-label="Schließen"
            >
              ✕
            </button>
          </header>
          <div className="flex min-h-0 flex-1 flex-col p-3">
            <DataChat />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="KI-Assistent"
        aria-label="KI-Assistent öffnen"
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-red text-2xl text-white shadow-lg shadow-black/30 transition-opacity hover:opacity-90"
      >
        {open ? "✕" : "💬"}
      </button>
    </>
  );
}
