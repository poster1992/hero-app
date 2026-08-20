"use client";

import { createContext, useContext, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ingestInboxBelegeAction } from "@/app/dashboard/belege/inbox-actions";

interface UploadQueueCtx {
  /** Legt Belege in die Hintergrund-Warteschlange (Verarbeitung läuft weiter, auch beim Navigieren). */
  enqueueBelege: (files: File[]) => void;
  active: boolean;
}

const Ctx = createContext<UploadQueueCtx>({ enqueueBelege: () => {}, active: false });

export function useUploadQueue(): UploadQueueCtx {
  return useContext(Ctx);
}

interface Progress {
  total: number;
  done: number;
  currentName: string | null;
  active: boolean;
  summary: { created: number; drafts: number; failed: number } | null;
}

const EMPTY: Progress = { total: 0, done: 0, currentName: null, active: false, summary: null };

export default function UploadQueueProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queueRef = useRef<File[]>([]);
  const runningRef = useRef(false);
  const acc = useRef({ created: 0, drafts: 0, failed: 0 });
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [p, setP] = useState<Progress>(EMPTY);

  const run = useCallback(async () => {
    runningRef.current = true;
    while (queueRef.current.length > 0) {
      const file = queueRef.current.shift()!;
      setP((s) => ({ ...s, currentName: file.name }));
      try {
        const fd = new FormData();
        fd.append("files", file);
        const res = await ingestInboxBelegeAction(fd);
        if (res.ok) {
          acc.current.created += res.created;
          acc.current.drafts += res.drafts;
          acc.current.failed += res.results.filter((r) => !r.ok).length;
        } else {
          acc.current.failed += 1;
        }
      } catch {
        acc.current.failed += 1;
      }
      setP((s) => ({ ...s, done: s.done + 1 }));
      // Liste im Hintergrund aktualisieren, sobald ein Beleg fertig ist.
      router.refresh();
    }
    runningRef.current = false;
    const summary = { ...acc.current };
    setP((s) => ({ ...s, active: false, currentName: null, summary }));
    router.refresh();
    // Zusammenfassung nach einigen Sekunden ausblenden.
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setP(EMPTY), 8000);
  }, [router]);

  const enqueueBelege = useCallback(
    (files: File[]) => {
      const list = files.filter(Boolean);
      if (list.length === 0) return;
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (!runningRef.current) {
        acc.current = { created: 0, drafts: 0, failed: 0 };
        queueRef.current.push(...list);
        setP({ total: list.length, done: 0, currentName: null, active: true, summary: null });
        void run();
      } else {
        queueRef.current.push(...list);
        setP((s) => ({ ...s, total: s.total + list.length, active: true, summary: null }));
      }
    },
    [run]
  );

  const show = p.active || p.summary != null;
  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;

  return (
    <Ctx.Provider value={{ enqueueBelege, active: p.active }}>
      {children}
      {show && (
        <div className="fixed bottom-4 right-4 z-[200] w-80 max-w-[92vw] rounded-xl border border-gray-200 bg-white shadow-2xl">
          <div className="flex items-start gap-3 p-4">
            <div className="text-xl" aria-hidden>
              {p.active ? "⏳" : p.summary && p.summary.failed > 0 ? "⚠️" : "✅"}
            </div>
            <div className="min-w-0 flex-1">
              {p.active ? (
                <>
                  <p className="text-sm font-semibold text-gray-900">
                    Belege werden hochgeladen … {p.done}/{p.total}
                  </p>
                  {p.currentName && (
                    <p className="mt-0.5 truncate text-xs text-gray-500">Aktuell: {p.currentName}</p>
                  )}
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-brand-red transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1.5 text-xs text-gray-400">Du kannst weiterarbeiten – läuft im Hintergrund.</p>
                </>
              ) : (
                p.summary && (
                  <>
                    <p className="text-sm font-semibold text-gray-900">Upload abgeschlossen</p>
                    <p className="mt-0.5 text-xs text-gray-600">
                      {p.summary.created} erfasst
                      {p.summary.drafts ? `, ${p.summary.drafts} als Entwurf` : ""}
                      {p.summary.failed ? `, ${p.summary.failed} fehlgeschlagen` : ""}.
                    </p>
                  </>
                )
              )}
            </div>
            {!p.active && (
              <button
                type="button"
                onClick={() => {
                  if (hideTimer.current) clearTimeout(hideTimer.current);
                  setP(EMPTY);
                }}
                className="shrink-0 text-gray-400 hover:text-gray-700"
                aria-label="Schließen"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
