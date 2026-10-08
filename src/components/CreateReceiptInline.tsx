"use client";

import { useEffect, useState } from "react";
import { getBelegFormOptionsAction } from "@/app/dashboard/belege/kontoauszug/actions";
import type { UploadBelegState } from "@/app/dashboard/belege/manual-actions";
import { ManualBelegeFormFields, type ProjectOption, type SupplierOption } from "@/components/ManualBelegeForm";
import type { BookAccount } from "@/lib/hero-api";
import type { AssignableReceiptOption } from "@/lib/kontoauszuege";

/**
 * Formular „Neuen Beleg erstellen" direkt innerhalb der Kontoauszug-
 * Zuordnung (für Zeilen, zu denen noch kein passender Beleg existiert –
 * bisher musste man dafür auf die Belege-Seite wechseln). Nutzt dasselbe
 * Formular wie „+ Beleg hochladen" (inkl. Pflichtfeld Konto), damit auch
 * hier angelegte Belege vollständig/korrekt verbucht sind. Nach dem
 * Speichern wird der neue Beleg direkt als Zuordnungs-Vorschlag übergeben
 * (kein erneutes Suchen nötig).
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

  if (loadError) return <p className="text-xs text-rose-600">Fehler: {loadError}</p>;
  if (!options) return <p className="text-xs text-gray-500">Formular wird geladen …</p>;

  return (
    <div className="border border-blue-300 bg-blue-50 p-2.5">
      <p className="mb-2 text-xs font-semibold text-gray-700">Neuen Beleg erstellen:</p>
      <ManualBelegeFormFields
        accounts={options.accounts}
        projects={options.projects}
        suppliers={options.suppliers}
        defaultValues={{ date: defaultDate, gross: defaultAmount > 0 ? defaultAmount : null }}
        onSuccess={handleSuccess}
        onCancel={onCancel}
        formClassName="grid grid-cols-1 gap-2 text-xs"
      />
    </div>
  );
}
