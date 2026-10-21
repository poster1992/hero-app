"use client";

import { useTransition } from "react";
import { confirmAndDeleteBeleg } from "@/lib/beleg-delete-client";

export default function DeleteBelegButton({ id, label }: { id: number; label?: string | null }) {
  const [busy, start] = useTransition();
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        start(async () => {
          await confirmAndDeleteBeleg(id, label ?? `Beleg ${id}`);
        });
      }}
      className="rounded-md border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-brand-red disabled:opacity-50"
      title="Beleg löschen"
    >
      {busy ? "…" : "Löschen"}
    </button>
  );
}
