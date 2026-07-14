"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmWorkdaysAction } from "@/app/dashboard/zeitfreigabe/actions";
import type { Workday } from "@/lib/hero-api";

const hours = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const weekday = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "2-digit" });

function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return weekday.format(new Date(Date.UTC(y, m - 1, d)));
}

interface DayGroup {
  date: string;
  entries: Workday[];
  openIds: number[];
}

export default function WorkdayApproval({
  workdays,
  from,
  to,
}: {
  workdays: Workday[];
  from: string;
  to: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  // Welche IDs gerade freigegeben werden (für die Zeilen-Anzeige).
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  // Nach Tag gruppieren (workdays kommen bereits nach Datum sortiert).
  const groups = useMemo<DayGroup[]>(() => {
    const map = new Map<string, Workday[]>();
    for (const w of workdays) {
      const list = map.get(w.date) ?? [];
      list.push(w);
      map.set(w.date, list);
    }
    return [...map.entries()].map(([date, entries]) => ({
      date,
      entries,
      openIds: entries.filter((e) => !e.confirmed).map((e) => e.id),
    }));
  }, [workdays]);

  const allOpenIds = useMemo(() => workdays.filter((w) => !w.confirmed).map((w) => w.id), [workdays]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleDay(g: DayGroup) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allChosen = g.openIds.every((id) => next.has(id));
      for (const id of g.openIds) {
        if (allChosen) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  function confirm(ids: number[], label: string) {
    if (ids.length === 0) return;
    if (!window.confirm(`${ids.length} ${ids.length === 1 ? "Tag" : "Tage"} in HERO freigeben (${label})?`)) return;

    setStatus(null);
    setBusyIds(new Set(ids));
    startTransition(async () => {
      const res = await confirmWorkdaysAction({ ids, from, to });
      setBusyIds(new Set());
      if (!res.ok) {
        setStatus({ ok: false, text: res.error ?? "Freigabe fehlgeschlagen." });
      } else {
        setStatus({
          ok: true,
          text: `${res.confirmed} ${res.confirmed === 1 ? "Tag" : "Tage"} freigegeben.`,
        });
        setSelected(new Set());
        router.refresh(); // frische Daten aus HERO nachladen
      }
    });
  }

  const selectedCount = selected.size;

  return (
    <div className="flex flex-col gap-4">
      {/* Aktionsleiste */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-300 bg-white px-5 py-3 shadow-lg shadow-black/10">
        <button
          type="button"
          disabled={pending || selectedCount === 0}
          onClick={() => confirm([...selected], "Auswahl")}
          className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Wird freigegeben …" : `Auswahl freigeben${selectedCount ? ` (${selectedCount})` : ""}`}
        </button>
        <button
          type="button"
          disabled={pending || allOpenIds.length === 0}
          onClick={() => confirm(allOpenIds, "ganze Woche")}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-brand-red/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Ganze Woche freigeben ({allOpenIds.length})
        </button>
        {status && (
          <span className={`text-sm ${status.ok ? "text-green-600" : "text-red-500"}`}>
            {status.ok ? "✅" : "⚠️"} {status.text}
          </span>
        )}
      </div>

      {/* Tage */}
      {groups.map((g) => {
        const allChosen = g.openIds.length > 0 && g.openIds.every((id) => selected.has(id));
        return (
          <div key={g.date} className="overflow-hidden rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-5 py-3">
              <h2 className="text-base font-semibold capitalize text-gray-900">{fmtDay(g.date)}</h2>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">
                  {g.openIds.length} offen · {g.entries.length - g.openIds.length} frei
                </span>
                {g.openIds.length > 0 && (
                  <>
                    <label className="flex items-center gap-1.5 text-xs text-gray-600">
                      <input type="checkbox" checked={allChosen} onChange={() => toggleDay(g)} />
                      Tag wählen
                    </label>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => confirm(g.openIds, fmtDay(g.date))}
                      className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-brand-red/50 disabled:opacity-50"
                    >
                      Tag freigeben
                    </button>
                  </>
                )}
              </div>
            </div>

            <ul className="divide-y divide-gray-100">
              {g.entries.map((w) => {
                const busy = busyIds.has(w.id);
                return (
                  <li key={w.id} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="w-5">
                      {!w.confirmed && (
                        <input
                          type="checkbox"
                          checked={selected.has(w.id)}
                          onChange={() => toggle(w.id)}
                          disabled={pending}
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{w.partnerName}</span>
                    <span className="shrink-0 text-sm tabular-nums text-gray-600">{hours.format(w.workedHours)} h</span>
                    <span className="w-24 shrink-0 text-right text-xs">
                      {busy ? (
                        <span className="text-gray-400">…</span>
                      ) : w.confirmed ? (
                        <span className="font-medium text-green-600">✓ freigegeben</span>
                      ) : (
                        <span className="text-amber-600">eingereicht</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
