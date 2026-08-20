"use client";

import { useState } from "react";
import DuplicateModal from "@/components/DuplicateModal";
import type { DuplicateGroup } from "@/lib/receipt-duplicates";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

/** Warnkasten „mögliche Dubletten" – jede Gruppe anklickbar → Dubletten-Popup (mit Löschen). */
export default function DuplicateWarning({ groups }: { groups: DuplicateGroup[] }) {
  const [sel, setSel] = useState<{ supplier: string | null; gross: number; date: string | null } | null>(null);

  if (groups.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900 shadow-sm">
      <p className="font-semibold">
        ⚠ {groups.length} mögliche {groups.length === 1 ? "Dublette" : "Dubletten"} (Lieferant + Betrag + Datum)
      </p>
      <ul className="mt-2 flex flex-col gap-0.5">
        {groups.slice(0, 12).map((g) => (
          <li key={g.key}>
            <button
              type="button"
              onClick={() => setSel({ supplier: g.supplier, gross: g.gross, date: g.date })}
              title="Dubletten anzeigen – zum Vergleichen/Löschen"
              className="rounded text-left underline-offset-2 transition-colors hover:text-amber-950 hover:underline"
            >
              {g.supplier || "—"} · {eur.format(g.gross)} · {g.date.split("-").reverse().join(".")}{" "}
              <span className="font-medium">({g.count}×)</span>
            </button>
          </li>
        ))}
        {groups.length > 12 && <li className="text-amber-700">… und {groups.length - 12} weitere</li>}
      </ul>

      {sel && (
        <DuplicateModal
          supplier={sel.supplier}
          gross={sel.gross}
          date={sel.date}
          onClose={() => setSel(null)}
        />
      )}
    </div>
  );
}
