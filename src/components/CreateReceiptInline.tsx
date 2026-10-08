"use client";

import { useEffect, useState } from "react";
import { getBelegFormOptionsAction } from "@/app/dashboard/belege/kontoauszug/actions";
import type { UploadBelegState } from "@/app/dashboard/belege/manual-actions";
import { ManualBelegeFormFields, type ProjectOption, type SupplierOption } from "@/components/ManualBelegeForm";
import type { BookAccount } from "@/lib/hero-api";
import type { AssignableReceiptOption } from "@/lib/kontoauszuege";

/**
 * Öffnet dasselbe Popup-Fenster wie „+ Beleg hochladen" auf der normalen
 * Belege-Seite (gleiches Formular `ManualBelegeFormFields`, gleiche
 * Modal-Optik) – aufrufbar direkt aus der Kontoauszug-Zuordnung, für Zeilen,
 * zu denen noch kein passender Beleg existiert (bisher musste man dafür auf
 * die Belege-Seite wechseln). Betrag/Datum werden aus der Zeile
 * vorausgefüllt; nach dem Speichern wird der neue Beleg direkt als
 * Zuordnungs-Vorschlag übergeben (kein erneutes Suchen nötig).
 */
export default function CreateReceiptInline({
  defaultAmount,
  defaultDate,
  onCreated,
  onCancel,
}: {
  /** Fehlender Betrag der Zeile – als Vorschlag ins Betragsfeld übernommen. */
  defaultAmount: number;
  /** Buchungsdatum der Zeile, falls bekannt – als Vorschlag ins Datumsfeld übernommen. */
  defaultDate: string | null;
  onCreated: (receipt: AssignableReceiptOption) => void;
  onCancel: () => void;
}) {
  const [options, setOptions] = useState<{
    accounts: BookAccount[];
    projects: ProjectOption[];
    suppliers: SupplierOption[];
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getBelegFormOptionsAction()
      .then((opts) => {
        if (!cancelled) setOptions(opts);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Konnte nicht geladen werden.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSuccess = (created?: UploadBelegState["createdReceipt"]) => {
    if (!created) return;
    onCreated({
      kind: "manual",
      ref: String(created.id),
      amount: created.openAmount,
      supplier: created.supplier,
      invoiceNumber: created.invoiceNumber,
      date: created.date,
      skontoPayAmount: created.skontoPayAmount,
    });
  };

  return (
    <div
      className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-3xl border border-line bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Beleg manuell hochladen</h2>
          <button
            type="button"
            onClick={onCancel}
            className="text-gray-400 transition-colors hover:text-gray-700"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>
        {loadError ? (
          <p className="text-sm text-rose-600">Fehler: {loadError}</p>
        ) : !options ? (
          <p className="text-sm text-gray-500">Formular wird geladen …</p>
        ) : (
          <ManualBelegeFormFields
            accounts={options.accounts}
            projects={options.projects}
            suppliers={options.suppliers}
            defaultValues={{ date: defaultDate, gross: defaultAmount > 0 ? defaultAmount : null }}
            onSuccess={handleSuccess}
            onCancel={onCancel}
          />
        )}
      </div>
    </div>
  );
}
