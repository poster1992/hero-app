"use client";

import { useEffect, useRef, useState } from "react";
import { saveNoteAction } from "@/app/dashboard/notizblock/actions";

type Status = "saved" | "dirty" | "saving" | "error";

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function Notepad({
  initialContent,
  initialUpdated,
}: {
  initialContent: string;
  initialUpdated: string | null;
}) {
  const [content, setContent] = useState(initialContent);
  const [status, setStatus] = useState<Status>("saved");
  const [updated, setUpdated] = useState<string | null>(initialUpdated);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(initialContent);
  const contentRef = useRef(initialContent);
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  const save = async () => {
    const toSave = contentRef.current;
    if (toSave === lastSaved.current) return;
    setStatus("saving");
    const res = await saveNoteAction(toSave);
    if (res.ok) {
      lastSaved.current = toSave;
      setUpdated(new Date().toISOString());
      // „saved" nur, wenn seither nichts Neues getippt wurde.
      setStatus(contentRef.current === toSave ? "saved" : "dirty");
    } else {
      setStatus("error");
    }
  };

  // Auto-Speichern 1,5 s nach der letzten Eingabe.
  useEffect(() => {
    if (content === lastSaved.current) return;
    setStatus("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 1500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  const statusText =
    status === "saving"
      ? "Speichert …"
      : status === "dirty"
        ? "Nicht gespeichert"
        : status === "error"
          ? "Fehler beim Speichern"
          : updated
            ? `Gespeichert · ${fmtTime(updated)}`
            : "Gespeichert";
  const statusColor =
    status === "error" ? "text-rose-600" : status === "dirty" ? "text-amber-600" : "text-emerald-600";

  return (
    <div className="flex flex-1 flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className={`font-mono text-xs ${statusColor}`}>{statusText}</span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={status === "saving" || content === lastSaved.current}
          className="rounded-md bg-brand-red px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Speichern
        </button>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onBlur={() => void save()}
        placeholder="Deine persönlichen Notizen … (nur für dich sichtbar, wird automatisch gespeichert)"
        className="min-h-[60vh] w-full flex-1 resize-y border border-line bg-white p-4 text-sm leading-relaxed text-gray-900 outline-none focus:border-brand-red/60"
      />
      <p className="text-xs text-gray-400">
        Nur für dich sichtbar. Wird automatisch gespeichert (1,5 s nach der letzten Eingabe) und beim Verlassen des Feldes.
      </p>
    </div>
  );
}
