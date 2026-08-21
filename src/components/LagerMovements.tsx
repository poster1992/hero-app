"use client";

import { useMemo, useState } from "react";
import type { StockMovement } from "@/lib/material-types";

const numberFmt = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

function formatDateTime(s: string | null): string {
  if (!s) return "";
  const d = new Date(s.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Filter = "all" | "in" | "out";

/** Buchungs-Historie (eigene Lager-Unterseite): die letzten Ein-/Ausbuchungen, filterbar. */
export default function LagerMovements({ movements }: { movements: StockMovement[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(
    () => ({
      all: movements.length,
      in: movements.filter((m) => m.delta >= 0).length,
      out: movements.filter((m) => m.delta < 0).length,
    }),
    [movements]
  );

  const filtered = useMemo(
    () =>
      filter === "in"
        ? movements.filter((m) => m.delta >= 0)
        : filter === "out"
          ? movements.filter((m) => m.delta < 0)
          : movements,
    [movements, filter]
  );

  const tabs: { key: Filter; label: string }[] = [
    { key: "all", label: "Alle" },
    { key: "in", label: "Einbuchungen" },
    { key: "out", label: "Ausbuchungen" },
  ];

  return (
    <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">Letzte Buchungen</h2>
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((t) => {
            const active = filter === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setFilter(t.key)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-brand-red text-white"
                    : "border border-gray-300 text-gray-600 hover:border-brand-red/50 hover:text-gray-900"
                }`}
              >
                {t.label} <span className={active ? "text-white/80" : "text-gray-400"}>({counts[t.key]})</span>
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400">
          {movements.length === 0 ? "Noch keine Buchungen." : "Keine Buchungen für diesen Filter."}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {filtered.map((mv) => (
            <li key={mv.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium text-gray-900">{mv.materialName}</span>
                {mv.projectName ? (
                  <span className="text-gray-500">
                    {" · "}
                    {mv.projectRelativeId != null ? `#${mv.projectRelativeId} ` : ""}
                    {mv.projectName}
                  </span>
                ) : (
                  ""
                )}
                {mv.comment ? <span className="text-gray-500"> · {mv.comment}</span> : ""}
                <span className="block text-xs text-gray-400">
                  {formatDateTime(mv.at)}
                  {mv.employeeName ? ` · ${mv.employeeName}` : mv.byName ? ` · ${mv.byName}` : ""}
                </span>
              </div>
              <span
                className={`shrink-0 font-semibold ${mv.delta >= 0 ? "text-emerald-700" : "text-rose-600"}`}
              >
                {mv.delta >= 0 ? "+" : ""}
                {numberFmt.format(mv.delta)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
