"use client";

import { useState } from "react";
import BelegDetailModal from "@/components/BelegDetailModal";
import type { EditableReceipt, ProjectOption, SupplierOption } from "@/components/ManualBelegeForm";

interface AccountOption {
  number: string;
  name: string;
}

/**
 * "Bearbeiten"-Button in der Belegliste – öffnet dasselbe zweispaltige Fenster
 * (PDF + Formular) wie in den Aufgaben.
 */
export default function BelegEditButton({
  receipt,
  accounts,
  projects,
  suppliers,
  hasFile = true,
}: {
  receipt: EditableReceipt;
  accounts: AccountOption[];
  projects: ProjectOption[];
  suppliers: SupplierOption[];
  hasFile?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
      >
        Bearbeiten
      </button>
      {open && (
        <BelegDetailModal
          belegId={receipt.id}
          receipt={receipt}
          accounts={accounts}
          projects={projects}
          suppliers={suppliers}
          hasFile={hasFile}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
