"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteAufmassAction,
  listAufmasseAction,
  reprocessAufmassAction,
  uploadAufmassAction,
  type AufmassUploadResult,
} from "@/app/dashboard/aufmass/actions";
import type { AufmassEntry } from "@/lib/aufmass-types";

function formatDateTime(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return d ? `${d}.${m}.${y}` : iso;
}

/** Farbiger Status-Chip je Aufmaß. */
function StatusBadge({ entry }: { entry: AufmassEntry }) {
  if (entry.status === "done") {
    return (
      <span className="whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-500/40">
        ✓ {entry.positionCount} {entry.positionCount === 1 ? "Position" : "Positionen"}
      </span>
    );
  }
  if (entry.status === "error") {
    return (
      <span className="whitespace-nowrap rounded-full bg-brand-red/10 px-2 py-0.5 text-[11px] font-semibold text-brand-red ring-1 ring-brand-red/40">
        ⚠ Fehler
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-500/40">
      … wird ausgewertet
    </span>
  );
}

/**
 * Aufmaß-Modul: handschriftliches Aufmaß (Foto/PDF) hineinziehen → die KI liest
 * es aus und erzeugt ein Word-Dokument, das direkt weiterbearbeitet werden kann.
 * Original und Word-Dokument bleiben im Archiv erhalten.
 */
export default function AufmassClient({ initial }: { initial: AufmassEntry[] }) {
  const router = useRouter();
  const [entries, setEntries] = useState<AufmassEntry[]>(initial);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [, startAction] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    const list = await listAufmasseAction().catch(() => null);
    if (list) setEntries(list);
    router.refresh();
  };

  const handleFiles = async (files: FileList | File[]) => {
    const list = [...files];
    if (list.length === 0) return;
    setError(null);
    setNote(null);
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      setBusy(`„${f.name}" wird ausgelesen … (${i + 1}/${list.length})`);
      const fd = new FormData();
      fd.set("file", f);
      const res: AufmassUploadResult = await uploadAufmassAction(fd).catch(() => ({
        ok: false,
        error: "Upload fehlgeschlagen.",
      }));
      if (!res.ok) setError(res.error ?? "Auswertung fehlgeschlagen.");
      else setNote(`„${f.name}": ${res.positions ?? 0} Positionen erkannt – Word-Dokument liegt bereit.`);
      await refresh();
    }
    setBusy(null);
  };

  const reprocess = (id: number) => {
    setError(null);
    setNote(null);
    setBusy("Aufmaß wird erneut ausgewertet …");
    startAction(async () => {
      const res: AufmassUploadResult = await reprocessAufmassAction(id).catch(() => ({
        ok: false,
        error: "Auswertung fehlgeschlagen.",
      }));
      if (!res.ok) setError(res.error ?? "Auswertung fehlgeschlagen.");
      else setNote(`Neu ausgewertet: ${res.positions ?? 0} Positionen.`);
      await refresh();
      setBusy(null);
    });
  };

  const remove = (entry: AufmassEntry) => {
    if (!window.confirm(`Aufmaß „${entry.title}" wirklich löschen (inkl. Word-Dokument)?`)) return;
    startAction(async () => {
      await deleteAufmassAction(entry.id);
      await refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Ablegefläche */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!busy) void handleFiles(e.dataTransfer.files);
        }}
        onClick={() => !busy && inputRef.current?.click()}
        className={`cursor-pointer border-2 border-dashed p-8 text-center transition-colors ${
          dragOver ? "border-brand-red bg-brand-red/5" : "border-gray-300 bg-white hover:border-brand-red/50"
        } ${busy ? "pointer-events-none opacity-60" : ""}`}
      >
        <p className="text-3xl">📐</p>
        <p className="mt-2 text-sm font-semibold text-gray-900">
          Handschriftliches Aufmaß hier hineinziehen
        </p>
        <p className="mt-1 text-sm text-gray-600">
          Foto (JPG/PNG) oder PDF · auch mehrere auf einmal · max. 25 MB je Datei
        </p>
        <p className="mt-1 text-xs text-gray-400">oder klicken zum Auswählen</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {busy && (
        <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          ⏳ {busy} – das dauert je Blatt etwa eine halbe bis eine Minute, bitte das Fenster offen lassen.
        </div>
      )}
      {error && (
        <div className="border border-brand-red/30 bg-brand-red/10 px-4 py-3 text-sm text-brand-red-dark">
          {error}
        </div>
      )}
      {note && !busy && (
        <div className="border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{note}</div>
      )}

      {/* Archiv */}
      <div className="border border-line bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
            Erfasste Aufmaße
          </h2>
          <span className="text-sm text-gray-500">{entries.length}</span>
        </div>

        {entries.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-400">
            Noch kein Aufmaß erfasst – oben ein Foto oder PDF hineinziehen.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-gray-900">{e.title}</span>
                    <StatusBadge entry={e} />
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
                    {[e.customer, e.project, formatDate(e.date)]
                      .filter(Boolean)
                      .map((part, i) => (
                        <span key={i}>
                          {i > 0 && <span className="mr-2 text-gray-300">·</span>}
                          {part}
                        </span>
                      ))}
                  </p>
                  <p className="mt-0.5 text-[11px] text-gray-400">
                    {e.fileName} · erfasst {formatDateTime(e.created)}
                    {e.createdByName ? ` · ${e.createdByName}` : ""}
                  </p>
                  {e.status === "error" && e.error && (
                    <p className="mt-1 text-xs text-brand-red">{e.error}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {e.hasDocx && (
                    <a
                      href={`/api/aufmass-datei?id=${e.id}&typ=word`}
                      className="rounded-md bg-brand-red px-2.5 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                    >
                      📘 Word herunterladen
                    </a>
                  )}
                  {e.hasDocx && (
                    <a
                      href={`/api/aufmass-datei?id=${e.id}&typ=excel`}
                      className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
                    >
                      📊 Excel herunterladen
                    </a>
                  )}
                  {e.hasFile && (
                    <a
                      href={`/api/aufmass-datei?id=${e.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
                    >
                      👁 Original
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => reprocess(e.id)}
                    disabled={!!busy}
                    title="Aufmaß erneut auslesen und Word-Dokument neu erzeugen"
                    className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900 disabled:opacity-50"
                  >
                    ↻ Neu auswerten
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(e)}
                    disabled={!!busy}
                    className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-brand-red disabled:opacity-50"
                  >
                    🗑
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-gray-500">
        Hinweis: Die Positionen werden aus der Handschrift gelesen – bitte im Word-Dokument gegenprüfen.
        Ganz am Ende des Dokuments steht die wörtliche Abschrift des Originals zum Abgleich.
      </p>
    </div>
  );
}
