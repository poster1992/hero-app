"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  listDuplicateBelegeAction,
  deleteBelegAction,
} from "@/app/dashboard/belege/manual-actions";
import type { DuplicateBeleg } from "@/lib/manual-receipts";

export interface HeroDuplicateMatch {
  id: string;
  number: string;
  supplier: string | null;
  gross: number;
  date: string | null;
  docUrl: string | null;
}

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return d ? `${d}.${m}.${y}` : iso;
}

/**
 * Dubletten-Popup: alle manuellen Belege mit gleichem Lieferant+Betrag+Datum
 * (löschbar) sowie optional passende HERO-Belege (nur zum Vergleich).
 */
export default function DuplicateModal({
  supplier,
  gross,
  date,
  heroMatches = [],
  onClose,
}: {
  supplier: string | null;
  gross: number;
  date: string | null;
  heroMatches?: HeroDuplicateMatch[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [manual, setManual] = useState<DuplicateBeleg[] | null>(null);
  const [busy, start] = useTransition();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    listDuplicateBelegeAction(supplier, gross, date)
      .then((list) => !cancelled && setManual(list))
      .catch(() => !cancelled && setManual([]));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [supplier, gross, date, onClose]);

  const remove = (id: number, label: string) => {
    if (!window.confirm(`Beleg „${label}" (#${id}) wirklich endgültig löschen?`)) return;
    const fd = new FormData();
    fd.set("id", String(id));
    start(async () => {
      await deleteBelegAction(fd);
      const list = await listDuplicateBelegeAction(supplier, gross, date).catch(() => null);
      setManual(list);
      router.refresh();
    });
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="my-8 flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-gray-300 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">Mögliche Dublette</h2>
            <p className="mt-0.5 truncate text-sm text-gray-500">
              {supplier ?? "—"} · {eur.format(gross)} · {fmtDate(date)}
            </p>
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
          {manual === null ? (
            <p className="py-6 text-center text-sm text-gray-500">Wird geladen …</p>
          ) : (
            <>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Manuelle Belege ({manual.length})
              </p>
              {manual.length === 0 ? (
                <p className="text-sm text-gray-400">Keine passenden manuellen Belege gefunden.</p>
              ) : (
                <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
                  {manual.map((m) => (
                    <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">
                          #{m.id} · {m.supplier ?? "—"}
                          <span className="ml-1 font-normal text-gray-500">{eur.format(m.gross)}</span>
                        </p>
                        <p className="truncate text-xs text-gray-500">
                          {fmtDate(m.date)}
                          {m.invoiceNumber ? ` · Nr. ${m.invoiceNumber}` : ""}
                          {m.source === "inbox" ? " · Posteingang" : m.source === "form" ? " · Formular" : ""}
                        </p>
                      </div>
                      {m.hasFile && (
                        <button
                          type="button"
                          onClick={() => window.open(`/api/beleg?id=${m.id}`, "_blank", "noopener,noreferrer")}
                          className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
                        >
                          👁 Ansehen
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => remove(m.id, m.supplier ?? m.invoiceNumber ?? `Beleg ${m.id}`)}
                        className="shrink-0 rounded-md bg-brand-red px-2.5 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        🗑 Löschen
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {heroMatches.length > 0 && (
                <>
                  <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    HERO-Belege ({heroMatches.length}) · nur zum Vergleich
                  </p>
                  <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
                    {heroMatches.map((h) => (
                      <li key={h.id} className="flex items-center gap-3 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900">
                            {h.number || "—"} · {h.supplier ?? "—"}
                            <span className="ml-1 font-normal text-gray-500">{eur.format(h.gross)}</span>
                          </p>
                          <p className="truncate text-xs text-gray-500">
                            {fmtDate(h.date)} · aus HERO (hier nicht löschbar)
                          </p>
                        </div>
                        {h.docUrl && (
                          <a
                            href={h.docUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
                          >
                            👁 Ansehen
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <p className="mt-3 text-xs text-gray-400">
                Tipp: Ist ein Beleg doppelt erfasst, hier den überflüssigen manuellen Beleg löschen. HERO-Belege
                können nur in HERO selbst gelöscht werden.
              </p>
            </>
          )}
        </div>

        <div className="flex justify-end border-t border-gray-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
