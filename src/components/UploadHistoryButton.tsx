"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { listUploadsAction } from "@/app/dashboard/belege/manual-actions";
import type { ManualReceiptUpload } from "@/lib/manual-receipts";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const dtFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" });
const dFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "short" });

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? iso : dtFmt.format(d);
}
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dFmt.format(d);
}

/** Kopfzeilen-Button „Upload-Verlauf": zeigt die manuellen Belege in der Reihenfolge,
 *  in der sie hochgeladen wurden (neueste zuerst) – unabhängig vom Belegdatum. */
export default function UploadHistoryButton() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ManualReceiptUpload[] | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || items !== null) return;
    listUploadsAction()
      .then(setItems)
      .catch(() => setItems([]));
  }, [open, items]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const modal = open && (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onClick={() => setOpen(false)}
    >
      <div
        className="max-h-[85vh] w-[80vw] max-w-5xl overflow-hidden rounded-xl border border-gray-300 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Upload-Verlauf</h2>
            <p className="mt-0.5 text-sm text-gray-600">
              Manuelle Belege in Hochlade-Reihenfolge (neueste zuerst){items ? ` · ${items.length}` : ""}.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-gray-400 transition-colors hover:text-gray-700"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[72vh] overflow-auto">
          {items === null ? (
            <p className="px-5 py-8 text-center text-sm text-gray-500">Wird geladen …</p>
          ) : items.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-500">Noch keine hochgeladenen Belege.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2 font-semibold">Hochgeladen</th>
                  <th className="px-3 py-2 font-semibold">Nr.</th>
                  <th className="px-3 py-2 font-semibold">Belegdatum</th>
                  <th className="px-3 py-2 font-semibold">Lieferant</th>
                  <th className="px-3 py-2 font-semibold">Quelle</th>
                  <th className="px-3 py-2 text-right font-semibold">Brutto</th>
                  <th className="px-3 py-2 font-semibold">Datei</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 tabular-nums text-gray-700">{fmtDateTime(r.created)}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold text-gray-500">#{r.id}</td>
                    <td className="px-3 py-2 tabular-nums text-gray-700">
                      {r.belegDate ? (
                        fmtDate(r.belegDate)
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                          kein Datum
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-900">
                      {r.supplier ?? "—"}
                      {r.confidential && (
                        <span className="ml-1.5 whitespace-nowrap rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-violet-500/40">
                          🔒 Vertraulich
                        </span>
                      )}
                      {r.invoiceNumber && <span className="ml-1 text-xs text-gray-400">· {r.invoiceNumber}</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{r.source === "inbox" ? "Posteingang" : "Formular"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-900">{eur.format(r.gross)}</td>
                    <td className="px-3 py-2">
                      {r.hasFile ? (
                        <a
                          href={`/api/beleg?id=${r.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-brand-red hover:underline"
                        >
                          👁 Ansehen
                        </a>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Belege in der Reihenfolge anzeigen, in der sie hochgeladen wurden"
        className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
      >
        🕑 Upload-Verlauf
      </button>
      {mounted && modal && createPortal(modal, document.body)}
    </>
  );
}
