"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  runManualOcrBackfill,
  type ManualOcrStatus,
} from "@/app/dashboard/belege/manual-ocr-index";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 4 });

/** Steuert die Volltext-OCR-Indexierung der manuellen Belege in wiederholten Blöcken. */
export default function ManualOcrPanel({ status }: { status: ManualOcrStatus }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(status.done);
  const [total, setTotal] = useState(status.total);
  const [cost, setCost] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  const remaining = Math.max(0, total - done);

  const run = async () => {
    setRunning(true);
    setMsg(null);
    let totalCost = 0;
    try {
      for (let i = 0; i < 300; i++) {
        const res = await runManualOcrBackfill();
        if (res.error) {
          setMsg(res.error);
          break;
        }
        totalCost += res.costEur;
        setTotal(res.total);
        setDone(res.total - res.remaining);
        setCost(Math.round(totalCost * 10000) / 10000);
        if (res.remaining <= 0 || res.processed === 0) {
          setMsg("Volltext-Indexierung abgeschlossen.");
          break;
        }
      }
      router.refresh();
    } catch {
      setMsg("Indexierung abgebrochen.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-gray-500">
        Volltext: {done}/{total}
        {cost > 0 ? ` · Kosten ca. ${eur.format(cost)}` : ""}
      </span>
      <button
        type="button"
        onClick={run}
        disabled={running || remaining === 0}
        title="Manuelle Belege per OCR auslesen (Volltextsuche im Belegtext)"
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900 disabled:opacity-50"
      >
        {running
          ? `Indexiere … (${done}/${total})`
          : remaining > 0
            ? `Volltext indexieren (${remaining})`
            : "Volltext ✓"}
      </button>
      {msg && <span className="text-xs text-gray-500">{msg}</span>}
    </div>
  );
}
