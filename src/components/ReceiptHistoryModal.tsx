"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { listReceiptHistoryAction } from "@/app/dashboard/belege/manual-actions";
import type { ReceiptHistoryEntry, ReceiptKind } from "@/lib/receipt-history";

/** DB-Zeitstempel („2026-09-03 14:05:11") als „03.09.2026, 14:05" anzeigen. */
function fmtAt(at: string | null): string {
  if (!at) return "Zeitpunkt unbekannt";
  const iso = at.includes("T") ? at : at.replace(" ", "T");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Historie eines Belegs (Rechtsklick → „Historie"): Erfassung, Bearbeitungen,
 * Zahlstatus, SEPA-Export, Rechnungsprüfung und verknüpfte Aufgaben –
 * chronologisch, älteste zuerst.
 */
export default function ReceiptHistoryModal({
  kind,
  receiptId,
  title,
  subtitle,
  onClose,
}: {
  kind: ReceiptKind;
  receiptId: number | string;
  title: string;
  subtitle?: string | null;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<ReceiptHistoryEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listReceiptHistoryAction(kind, receiptId)
      .then((list) => !cancelled && setEntries(list))
      .catch(() => !cancelled && setEntries([]));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [kind, receiptId, onClose]);

  // Das Fenster wird erst nach einem Klick gerendert – `document` ist hier immer da.
  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="my-8 flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden border border-line bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">Historie · {title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-sm text-gray-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="shrink-0 text-gray-400 transition-colors hover:text-gray-700"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {entries === null ? (
            <p className="py-6 text-center text-sm text-gray-500">Wird geladen …</p>
          ) : entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">
              Für diesen Beleg ist noch nichts protokolliert.
            </p>
          ) : (
            <ol className="space-y-0">
              {entries.map((e, i) => (
                <li key={e.key} className="relative flex gap-3 pb-4 last:pb-0">
                  {/* Verbindungslinie der Zeitleiste (nicht beim letzten Eintrag). */}
                  {i < entries.length - 1 && (
                    <span className="absolute left-[13px] top-7 h-[calc(100%-1.25rem)] w-px bg-gray-200" />
                  )}
                  <span className="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-sm">
                    {e.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">{e.label}</p>
                    {e.detail && (
                      // Notizen können mehrzeilig sein – Zeilenumbrüche erhalten.
                      <p className="mt-0.5 whitespace-pre-line break-words text-sm text-gray-600">{e.detail}</p>
                    )}
                    <p className="mt-0.5 text-xs text-gray-500">
                      {fmtAt(e.at)}
                      {e.byName ? ` · ${e.byName}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-400">
            Erfassung, Zahlung und Prüfung werden auch für ältere Belege aus den vorhandenen Daten
            abgeleitet; Bearbeitungen im Detail werden ab Einführung der Historie protokolliert.
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}
