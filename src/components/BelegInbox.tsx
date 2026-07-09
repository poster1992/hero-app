"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  ingestInboxBelegeAction,
  type InboxItemResult,
} from "@/app/dashboard/belege/inbox-actions";

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("de-DE");
}

/** Liest Dateien robust aus einem Drop-Event (files, sonst items-Fallback). */
function filesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  if (dt.files && dt.files.length > 0) return Array.from(dt.files);
  const out: File[] = [];
  if (dt.items) {
    for (const item of Array.from(dt.items)) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  return out;
}

interface Pending {
  key: string;
  file: File;
}

export default function BelegInbox() {
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [processing, startProcessing] = useTransition();
  const [results, setResults] = useState<InboxItemResult[] | null>(null);
  const [summary, setSummary] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.size > 0);
    if (list.length === 0) return;
    setPending((prev) => [
      ...prev,
      ...list.map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, file })),
    ]);
  }, []);

  // Native Drag&Drop (zuverlässiger als React-Synthetic).
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const over = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        try {
          e.dataTransfer.dropEffect = "copy";
        } catch {
          /* egal */
        }
      }
      setDragOver(true);
    };
    const enter = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!el.contains(e.relatedTarget as Node | null)) setDragOver(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      addFiles(filesFromDataTransfer(e.dataTransfer));
    };
    el.addEventListener("dragenter", enter);
    el.addEventListener("dragover", over);
    el.addEventListener("dragleave", leave);
    el.addEventListener("drop", drop);
    return () => {
      el.removeEventListener("dragenter", enter);
      el.removeEventListener("dragover", over);
      el.removeEventListener("dragleave", leave);
      el.removeEventListener("drop", drop);
    };
  }, [addFiles]);

  // Browser-Default (Datei öffnen) global verhindern.
  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  const process = () => {
    if (pending.length === 0 || processing) return;
    setResults(null);
    setSummary(null);
    startProcessing(async () => {
      const fd = new FormData();
      for (const p of pending) fd.append("files", p.file);
      const res = await ingestInboxBelegeAction(fd);
      if (!res.ok) {
        setSummary({ ok: false, text: res.error ?? "Verarbeitung fehlgeschlagen." });
        return;
      }
      setResults(res.results);
      setPending([]);
      const failed = res.results.filter((r) => !r.ok).length;
      setSummary({
        ok: failed === 0,
        text: `${res.created} erfasst${res.drafts ? `, ${res.drafts} als Entwurf (nicht erkannt)` : ""}${
          failed ? `, ${failed} fehlgeschlagen` : ""
        }.`,
      });
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Ablagefläche */}
      <div
        ref={dropRef}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragOver ? "border-brand-red bg-brand-red/5" : "border-gray-300 bg-white hover:border-brand-red/50"
        }`}
      >
        <p className="text-sm text-gray-700">
          <span className="font-medium text-brand-red">Dateien auswählen</span> oder mehrere PDFs hierher ziehen
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Belege werden automatisch erkannt und erfasst (Betrag, MwSt, Datum, Lieferant, Konto). Max. 25 MB je Datei.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* Warteschlange */}
      {pending.length > 0 && (
        <div className="rounded-xl border border-gray-300 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Bereit zur Verarbeitung ({pending.length})</h3>
            <button
              type="button"
              onClick={() => setPending([])}
              disabled={processing}
              className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50"
            >
              Leeren
            </button>
          </div>
          <ul className="mb-3 flex flex-col gap-1">
            {pending.map((p, i) => (
              <li key={p.key} className="flex items-center gap-2 text-sm text-gray-700">
                <span className="text-base" aria-hidden>📄</span>
                <span className="min-w-0 flex-1 truncate">{p.file.name}</span>
                <button
                  type="button"
                  onClick={() => setPending((prev) => prev.filter((_, j) => j !== i))}
                  disabled={processing}
                  className="shrink-0 rounded border border-gray-300 px-1.5 text-xs text-gray-500 hover:text-brand-red"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={process}
            disabled={processing}
            className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {processing ? "Wird ausgewertet …" : `${pending.length} Beleg${pending.length === 1 ? "" : "e"} auswerten`}
          </button>
          {processing && (
            <p className="mt-2 text-xs text-gray-500">Je Beleg einige Sekunden – bitte warten …</p>
          )}
        </div>
      )}

      {summary && (
        <div
          className={`rounded-md border p-3 text-sm ${
            summary.ok
              ? "border-green-300 bg-green-50 text-green-800"
              : "border-brand-red/30 bg-brand-red/10 text-red-700"
          }`}
        >
          {summary.text}
        </div>
      )}

      {/* Ergebnis je Datei */}
      {results && results.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-300 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 [&>th]:px-4 [&>th]:py-2">
                <th>Datei</th>
                <th>Typ</th>
                <th className="text-right">Betrag</th>
                <th>Datum</th>
                <th>Konto</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-2">
                    <span className="block max-w-[16rem] truncate text-gray-800">{r.fileName}</span>
                    {r.supplier && <span className="block truncate text-xs text-gray-500">{r.supplier}</span>}
                  </td>
                  <td className="px-4 py-2 text-gray-700">{r.kindLabel ?? "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-800">
                    {r.total != null ? euro.format(r.total) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-gray-600">{fmtDate(r.date) || "—"}</td>
                  <td className="px-4 py-2 text-gray-600">{r.accountNumber ?? "—"}</td>
                  <td className="px-4 py-2">
                    {!r.ok ? (
                      <span className="rounded-full bg-brand-red/10 px-2 py-0.5 text-xs font-medium text-red-700">
                        Fehler{r.error ? `: ${r.error}` : ""}
                      </span>
                    ) : r.draft ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        Entwurf – nicht erkannt
                      </span>
                    ) : (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                        Erfasst
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400">
        Erfasste Belege erscheinen unten in der Liste „Manuelle Belege" (dort prüf-/editierbar). Über einen
        Workflow („Neuer erfasster Beleg") kann automatisch eine Prüf-Aufgabe erstellt werden.
      </p>
    </div>
  );
}
