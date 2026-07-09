"use client";

import { useTransition } from "react";
import { deleteBelegAction } from "@/app/dashboard/belege/manual-actions";

export default function DeleteBelegButton({ id, label }: { id: number; label?: string | null }) {
  const [busy, start] = useTransition();
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        if (!window.confirm(`Beleg${label ? ` „${label}"` : ""} wirklich löschen?`)) return;
        const fd = new FormData();
        fd.set("id", String(id));
        start(async () => {
          await deleteBelegAction(fd);
        });
      }}
      className="rounded-md border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-brand-red disabled:opacity-50"
      title="Beleg löschen"
    >
      {busy ? "…" : "Löschen"}
    </button>
  );
}
