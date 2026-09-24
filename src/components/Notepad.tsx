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

/** Markieren (Hintergrund) – kleine feste Farbauswahl. */
const HIGHLIGHTS: { label: string; value: string }[] = [
  { label: "Gelb", value: "#fef08a" },
  { label: "Grün", value: "#bbf7d0" },
  { label: "Blau", value: "#bfdbfe" },
  { label: "Rosa", value: "#fecdd3" },
];

/** Textfarbe – kleine feste Farbauswahl (letzte = zurück auf Standard). */
const TEXT_COLORS: { label: string; value: string }[] = [
  { label: "Rot", value: "#dc2626" },
  { label: "Grün", value: "#16a34a" },
  { label: "Blau", value: "#2563eb" },
  { label: "Standard", value: "#111827" },
];

/**
 * Alte Notizen (reiner Text aus der vorherigen Textarea-Version, kein HTML)
 * beim ersten Laden sicher als HTML darstellen, statt sie als Markup zu
 * interpretieren.
 */
function toEditableHtml(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("<")) return raw; // schon HTML (neues Format)
  const escaped = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped.replace(/\n/g, "<br>");
}

export default function Notepad({
  initialContent,
  initialUpdated,
}: {
  initialContent: string;
  initialUpdated: string | null;
}) {
  const [status, setStatus] = useState<Status>("saved");
  const [dirty, setDirty] = useState(false);
  const [updated, setUpdated] = useState<string | null>(initialUpdated);
  const [isEmpty, setIsEmpty] = useState(!initialContent.trim());
  const editorRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(initialContent);

  // Startinhalt einmalig setzen (unkontrolliertes contentEditable – sonst
  // springt der Cursor bei jedem Tastendruck an den Anfang zurück).
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = toEditableHtml(initialContent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    const el = editorRef.current;
    if (!el) return;
    const blank = (el.textContent ?? "").trim() === "";
    const toSave = blank ? "" : el.innerHTML;
    if (toSave === lastSaved.current) {
      setDirty(false);
      return;
    }
    setStatus("saving");
    const res = await saveNoteAction(toSave);
    if (res.ok) {
      lastSaved.current = toSave;
      setUpdated(new Date().toISOString());
      // Zwischenzeitlich weitergetippt? Dann bleibt der Status "dirty".
      const current = editorRef.current;
      const stillSame = current ? current.innerHTML === toSave || ((current.textContent ?? "").trim() === "" && blank) : true;
      setDirty(!stillSame);
      setStatus(stillSame ? "saved" : "dirty");
    } else {
      setStatus("error");
    }
  };

  const scheduleSave = () => {
    setStatus("dirty");
    setDirty(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 1500);
  };

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const handleInput = () => {
    setIsEmpty((editorRef.current?.textContent ?? "").trim() === "");
    scheduleSave();
  };

  // Auswahl im Editor beim Klick auf einen Werkzeugleisten-Button behalten
  // (sonst verliert der contentEditable-Bereich beim Klick den Fokus, bevor
  // der Befehl ausgeführt wird).
  const keepSelection = (e: React.MouseEvent) => e.preventDefault();
  const exec = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    handleInput();
  };

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
          disabled={status === "saving" || !dirty}
          className="rounded-md bg-brand-red px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Speichern
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-4 border border-line bg-gray-50 px-3 py-2">
        <button
          type="button"
          onMouseDown={keepSelection}
          onClick={() => exec("bold")}
          title="Fett"
          className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-bold text-gray-800 hover:bg-gray-100"
        >
          F
        </button>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">Markieren:</span>
          {HIGHLIGHTS.map((h) => (
            <button
              key={h.value}
              type="button"
              onMouseDown={keepSelection}
              onClick={() => exec("hiliteColor", h.value)}
              title={h.label}
              style={{ backgroundColor: h.value }}
              className="h-5 w-5 rounded border border-gray-300"
            />
          ))}
          <button
            type="button"
            onMouseDown={keepSelection}
            onClick={() => exec("hiliteColor", "transparent")}
            title="Markierung entfernen"
            className="h-5 w-5 rounded border border-gray-300 bg-white text-[10px] leading-[18px] text-gray-400"
          >
            ✕
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">Textfarbe:</span>
          {TEXT_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              onMouseDown={keepSelection}
              onClick={() => exec("foreColor", c.value)}
              title={c.label}
              style={{ backgroundColor: c.value }}
              className="h-5 w-5 rounded-full border border-gray-300"
            />
          ))}
        </div>
      </div>

      <div className="relative flex flex-1 flex-col">
        {isEmpty && (
          <span className="pointer-events-none absolute left-4 top-4 text-sm text-gray-400">
            Deine persönlichen Notizen … (nur für dich sichtbar, wird automatisch gespeichert)
          </span>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onBlur={() => void save()}
          className="min-h-[60vh] w-full flex-1 overflow-y-auto whitespace-pre-wrap border border-line bg-white p-4 text-sm leading-relaxed text-gray-900 outline-none focus:border-brand-red/60"
        />
      </div>
      <p className="text-xs text-gray-400">
        Nur für dich sichtbar. Wird automatisch gespeichert (1,5 s nach der letzten Eingabe) und beim Verlassen des Feldes.
      </p>
    </div>
  );
}
