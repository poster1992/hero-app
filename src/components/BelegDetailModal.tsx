"use client";

import type { ReactNode } from "react";
import {
  ManualBelegeFormFields,
  type EditableReceipt,
  type ProjectOption,
  type SupplierOption,
} from "@/components/ManualBelegeForm";

interface AccountOption {
  number: string;
  name: string;
}

/**
 * Zweispaltiges Beleg-Fenster (95% Bildschirm): links die PDF-Vorschau, rechts
 * direkt das Bearbeiten-Formular. Wird sowohl in der Belegliste als auch in den
 * Aufgaben verwendet – ein Fenster, eine Quelle.
 */
export default function BelegDetailModal({
  belegId,
  receipt,
  accounts,
  projects,
  suppliers,
  title,
  hasFile = true,
  extraFooter,
  onClose,
}: {
  belegId: number | string;
  receipt: EditableReceipt;
  accounts: AccountOption[];
  projects: ProjectOption[];
  suppliers: SupplierOption[];
  /** Fenstertitel (Standard: "Beleg #<id>"). */
  title?: string;
  /** Ob ein PDF/Bild hinterlegt ist (sonst Platzhalter statt Vorschau). */
  hasFile?: boolean;
  /** Zusätzliche Aktionen im Footer (z. B. "Geprüft & abschließen" bei Aufgaben). */
  extraFooter?: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[95vh] w-[95vw] max-w-none flex-col overflow-hidden rounded-xl border border-gray-300 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h3 className="min-w-0 truncate text-sm font-semibold text-gray-900">
            {title ?? `Beleg #${belegId}`}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="ml-2 shrink-0 text-gray-400 transition-colors hover:text-gray-700"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>

        {/* Zweispaltig: links Beleg-Vorschau, rechts direkt bearbeiten */}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {hasFile ? (
            <iframe
              src={`/api/beleg?id=${belegId}#zoom=80`}
              title={`Beleg ${belegId}`}
              className="min-h-0 flex-1 bg-gray-100 md:w-1/2 md:flex-none md:border-r md:border-gray-200"
            />
          ) : (
            <div className="flex min-h-[8rem] flex-1 items-center justify-center bg-gray-100 p-6 text-center text-sm text-gray-500 md:w-1/2 md:flex-none md:border-r md:border-gray-200">
              Keine Datei hinterlegt.
            </div>
          )}
          <div className="min-h-0 overflow-y-auto border-t border-gray-200 p-4 md:w-1/2 md:border-t-0">
            <ManualBelegeFormFields
              accounts={accounts}
              projects={projects}
              suppliers={suppliers}
              receipt={receipt}
              formClassName="grid grid-cols-1 gap-3"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 px-4 py-3">
          {hasFile ? (
            <a
              href={`/api/beleg?id=${belegId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
            >
              In neuem Tab öffnen
            </a>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {extraFooter}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              Schließen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
