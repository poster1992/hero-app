"use client";

import { useMemo, useState } from "react";
import type { GlobalLogEntry } from "@/lib/logbook-core";

const dtFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function fmt(s: string | null): string {
  if (!s) return "";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : dtFmt.format(d);
}

export default function ActivityLog({ entries }: { entries: GlobalLogEntry[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      `${e.title} ${e.text} ${e.author ?? ""} ${e.projectName ?? ""} ${e.projectRelativeId ?? ""}`
        .toLowerCase()
        .includes(q)
    );
  }, [entries, search]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Suchen (Projekt, Aktion, Text, Mitarbeiter …)"
          className="w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-red focus:outline-none"
        />
        <span className="ml-auto text-sm text-gray-500">{filtered.length} Einträge</span>
      </div>

      <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        {filtered.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-500">Keine Einträge.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filtered.map((e) => (
              <li key={e.id} className="px-5 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-sm font-medium text-gray-900">{e.title || "—"}</span>
                  <span className="text-xs text-gray-500">
                    {fmt(e.date)}
                    {e.author ? ` · ${e.author}` : ""}
                  </span>
                </div>
                {e.projectName && (
                  <p className="mt-0.5 text-xs text-brand-red">
                    📁 {e.projectRelativeId != null ? `#${e.projectRelativeId} ` : ""}
                    {e.projectName}
                  </p>
                )}
                {e.text && <p className="mt-1 whitespace-pre-wrap text-xs text-gray-600">{e.text}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
