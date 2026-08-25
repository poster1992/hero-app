"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  listUploadsAction,
  loadEditableReceiptAction,
  deleteBelegAction,
} from "@/app/dashboard/belege/manual-actions";
import BelegDetailModal from "@/components/BelegDetailModal";
import type { EditableReceipt, ProjectOption, SupplierOption } from "@/components/ManualBelegeForm";
import type { ManualReceiptUpload } from "@/lib/manual-receipts";

type AccountOption = { number: string; name: string };

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
export default function UploadHistoryButton({
  accounts,
  projects,
  suppliers,
}: {
  accounts: AccountOption[];
  projects: ProjectOption[];
  suppliers: SupplierOption[];
}) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ManualReceiptUpload[] | null>(null);
  const [menu, setMenu] = useState<{ row: ManualReceiptUpload; x: number; y: number } | null>(null);
  const [editData, setEditData] = useState<{ receipt: EditableReceipt; hasFile: boolean } | null>(null);
  const [, startAction] = useTransition();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || items !== null) return;
    listUploadsAction()
      .then(setItems)
      .catch(() => setItems([]));
  }, [open, items]);

  const reload = () => setItems(null); // löst den Lade-Effekt erneut aus

  const doEdit = (row: ManualReceiptUpload) => {
    setMenu(null);
    startAction(async () => {
      const data = await loadEditableReceiptAction(row.id);
      if (data) {
        setOpen(false); // Verlauf-Fenster schließen, damit der Editor oben liegt
        setEditData(data);
      }
    });
  };

  const doDelete = (row: ManualReceiptUpload) => {
    setMenu(null);
    const label = row.supplier ?? row.invoiceNumber ?? `Beleg ${row.id}`;
    if (!window.confirm(`Beleg „${label}" (#${row.id}) wirklich löschen?`)) return;
    const fd = new FormData();
    fd.set("id", String(row.id));
    startAction(async () => {
      await deleteBelegAction(fd);
      reload();
    });
  };

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
        className="max-h-[85vh] w-[80vw] max-w-5xl overflow-hidden border border-line bg-white shadow-2xl"
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
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-gray-100 hover:bg-gray-50"
                    title="Rechtsklick für Aktionen (Bearbeiten / Löschen)"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({
                        row: r,
                        x: Math.min(e.clientX, window.innerWidth - 180),
                        y: Math.min(e.clientY, window.innerHeight - 120),
                      });
                    }}
                  >
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
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );

  const contextMenu = menu && (
    <>
      <div
        className="fixed inset-0 z-[130]"
        onClick={() => setMenu(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu(null);
        }}
      />
      <div
        className="fixed z-[131] w-44 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-xl"
        style={{ left: menu.x, top: menu.y }}
      >
        {menu.row.hasFile && (
          <button
            type="button"
            onClick={() => {
              window.open(`/api/beleg?id=${menu.row.id}`, "_blank", "noopener,noreferrer");
              setMenu(null);
            }}
            className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            👁 Ansehen
          </button>
        )}
        <button
          type="button"
          onClick={() => doEdit(menu.row)}
          className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
        >
          ✏️ Bearbeiten
        </button>
        <button
          type="button"
          onClick={() => doDelete(menu.row)}
          className="block w-full px-3 py-2 text-left text-sm font-medium text-brand-red hover:bg-gray-50"
        >
          🗑 Löschen
        </button>
      </div>
    </>
  );

  const editModal = editData && (
    <BelegDetailModal
      belegId={editData.receipt.id}
      receipt={editData.receipt}
      accounts={accounts}
      projects={projects}
      suppliers={suppliers}
      hasFile={editData.hasFile}
      onClose={() => {
        setEditData(null);
        reload();
      }}
    />
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
      {mounted && contextMenu && createPortal(contextMenu, document.body)}
      {mounted && editModal && createPortal(editModal, document.body)}
    </>
  );
}
