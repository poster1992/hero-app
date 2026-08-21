"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StockMovement } from "@/lib/material-types";
import { deleteMovementAction } from "@/app/dashboard/lager/actions";

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
export default function LagerMovements({
  movements,
  isAdmin = false,
}: {
  movements: StockMovement[];
  isAdmin?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [, startDelete] = useTransition();

  const onDelete = (mv: StockMovement) => {
    const dir = mv.delta >= 0 ? "Einbuchung" : "Ausbuchung";
    if (
      !window.confirm(
        `${dir} „${mv.materialName}" (${mv.delta >= 0 ? "+" : ""}${numberFmt.format(mv.delta)}) wirklich löschen?\n\nDer Lagerbestand wird entsprechend zurückgerechnet.`
      )
    )
      return;
    setDeletingId(mv.id);
    startDelete(async () => {
      await deleteMovementAction(mv.id);
      setDeletingId(null);
      router.refresh();
    });
  };

  const counts = useMemo(
    () => ({
      all: movements.length,
      in: movements.filter((m) => m.delta >= 0).length,
      out: movements.filter((m) => m.delta < 0).length,
    }),
    [movements]
  );

  const filtered = useMemo(() => {
    const byDir =
      filter === "in"
        ? movements.filter((m) => m.delta >= 0)
        : filter === "out"
          ? movements.filter((m) => m.delta < 0)
          : movements;
    const q = search.trim().toLowerCase();
    if (!q) return byDir;
    // Wortweise Suche (UND) über Artikel, Projekt (+Nr.), Mitarbeiter, Kommentar.
    const words = q.split(/\s+/).filter(Boolean);
    return byDir.filter((m) => {
      const hay = [
        m.materialName,
        m.projectName,
        m.projectRelativeId != null ? `#${m.projectRelativeId}` : "",
        m.employeeName,
        m.byName,
        m.comment,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [movements, filter, search]);

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

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Suchen (Artikel, Projekt, Mitarbeiter, Kommentar) …"
        className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60"
      />

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
              <div className="flex shrink-0 items-center gap-2">
                <span className={`font-semibold ${mv.delta >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                  {mv.delta >= 0 ? "+" : ""}
                  {numberFmt.format(mv.delta)}
                </span>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => onDelete(mv)}
                    disabled={deletingId === mv.id}
                    title="Buchung löschen (Bestand wird zurückgerechnet)"
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-400 transition-colors hover:border-brand-red/50 hover:text-brand-red disabled:opacity-50"
                    aria-label="Buchung löschen"
                  >
                    {deletingId === mv.id ? "…" : "🗑"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
