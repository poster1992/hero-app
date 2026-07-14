"use client";

import { useRef, useState, useTransition } from "react";
import { uploadBaustellenFotosAction } from "@/app/dashboard/baustellen/actions";

/**
 * "+"-Button über der Baustellen-Galerie: lädt Fotos direkt nach HERO hoch
 * (in die Bild-Kategorie des Ordners). Danach kommen sie über die normale
 * HERO-Abfrage wieder in die Galerie zurück.
 */
export default function PhotoUploadButton({ baustelleId }: { baustelleId: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, startUpload] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  function onFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    setStatus(null);

    startUpload(async () => {
      const fd = new FormData();
      fd.append("baustelleId", String(baustelleId));
      for (const f of files) fd.append("files", f);

      const res = await uploadBaustellenFotosAction(fd);
      if (!res.ok) {
        setStatus({ ok: false, text: res.error ?? "Upload fehlgeschlagen." });
      } else {
        setStatus({
          ok: true,
          text:
            (res.uploaded === 1 ? "1 Foto hochgeladen" : `${res.uploaded} Fotos hochgeladen`) +
            (res.error ? ` – ${res.error}` : ""),
        });
      }
      // Gleiche Datei soll erneut wählbar sein.
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-2 rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-black/10 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        title="Fotos zu diesem Projekt in HERO hochladen"
      >
        <span className="text-lg leading-none">＋</span>
        {uploading ? "Wird hochgeladen…" : "Fotos hinzufügen"}
      </button>

      {status && (
        <span className={`text-sm ${status.ok ? "text-green-600" : "text-red-500"}`}>
          {status.ok ? "✅" : "⚠️"} {status.text}
        </span>
      )}
    </div>
  );
}
