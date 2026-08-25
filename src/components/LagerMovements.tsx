"use client";

import { useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { StockMovement } from "@/lib/material-types";
import { deleteMovementAction, updateMovementAction } from "@/app/dashboard/lager/actions";

export interface MovementProjectOption {
  relativeId: number | null;
  name: string;
}

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
  projects = [],
}: {
  movements: StockMovement[];
  isAdmin?: boolean;
  projects?: MovementProjectOption[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [, startDelete] = useTransition();

  // Bearbeiten (Admin): Richtung + Projekt einer Buchung ändern.
  const [edit, setEdit] = useState<StockMovement | null>(null);
  const [editDir, setEditDir] = useState<"in" | "out">("in");
  const [editRel, setEditRel] = useState<number | null>(null);
  const [editName, setEditName] = useState<string | null>(null);
  const [projQuery, setProjQuery] = useState("");
  const [saving, startSave] = useTransition();
  const [editErr, setEditErr] = useState<string | null>(null);

  const openEdit = (mv: StockMovement) => {
    setEdit(mv);
    setEditDir(mv.delta >= 0 ? "in" : "out");
    setEditRel(mv.projectRelativeId);
    setEditName(mv.projectName);
    setProjQuery("");
    setEditErr(null);
  };
  const projMatches = useMemo(() => {
    const q = projQuery.trim().toLowerCase();
    if (!q) return [];
    return projects
      .filter(
        (p) => p.name.toLowerCase().includes(q) || (p.relativeId != null && String(p.relativeId).includes(q))
      )
      .slice(0, 8);
  }, [projQuery, projects]);
  const saveEdit = () => {
    if (!edit) return;
    setEditErr(null);
    startSave(async () => {
      const res = await updateMovementAction({
        id: edit.id,
        direction: editDir,
        projectRelativeId: editRel,
        projectName: editName,
      });
      if (res.ok) {
        setEdit(null);
        router.refresh();
      } else {
        setEditErr(res.error ?? "Fehlgeschlagen.");
      }
    });
  };

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
    <div className="border border-line bg-white p-5">
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
                    onClick={() => openEdit(mv)}
                    title="Buchung bearbeiten (Richtung/Projekt ändern)"
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-400 transition-colors hover:border-brand-red/50 hover:text-brand-red"
                    aria-label="Buchung bearbeiten"
                  >
                    ✏️
                  </button>
                )}
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

      {edit &&
        createPortal(
          <div
            className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
            onClick={() => setEdit(null)}
          >
            <div
              className="my-8 w-full max-w-md border border-line bg-white p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-gray-900">Buchung bearbeiten</h2>
                  <p className="truncate text-sm text-gray-500">{edit.materialName}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEdit(null)}
                  aria-label="Schließen"
                  className="text-gray-400 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>

              {/* Richtung */}
              <p className="mb-1 text-sm font-medium text-gray-700">Richtung</p>
              <div className="mb-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setEditDir("in")}
                  className={`rounded-lg border py-2.5 text-sm font-semibold ${
                    editDir === "in"
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700 ring-2 ring-emerald-500/30"
                      : "border-gray-300 text-gray-700"
                  }`}
                >
                  ＋ Einbuchen
                </button>
                <button
                  type="button"
                  onClick={() => setEditDir("out")}
                  className={`rounded-lg border py-2.5 text-sm font-semibold ${
                    editDir === "out"
                      ? "border-rose-500 bg-rose-50 text-rose-700 ring-2 ring-rose-500/30"
                      : "border-gray-300 text-gray-700"
                  }`}
                >
                  － Ausbuchen
                </button>
              </div>

              {/* Projekt */}
              <p className="mb-1 text-sm font-medium text-gray-700">Projekt</p>
              {editRel != null || editName ? (
                <div className="mb-2 flex items-center justify-between rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-gray-900">
                    {editRel != null ? `#${editRel} ` : ""}
                    {editName ?? ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditRel(null);
                      setEditName(null);
                    }}
                    className="ml-2 shrink-0 rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-200"
                  >
                    entfernen
                  </button>
                </div>
              ) : (
                <div className="relative mb-2">
                  <input
                    type="text"
                    value={projQuery}
                    onChange={(e) => setProjQuery(e.target.value)}
                    placeholder="Projekt suchen (Name oder Nummer) …"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-red/60"
                  />
                  {projMatches.length > 0 && (
                    <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                      {projMatches.map((p) => (
                        <li key={p.relativeId ?? p.name}>
                          <button
                            type="button"
                            onClick={() => {
                              setEditRel(p.relativeId);
                              setEditName(p.name);
                              setProjQuery("");
                            }}
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100"
                          >
                            {p.relativeId != null && <span className="text-gray-500">#{p.relativeId} </span>}
                            {p.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {editErr && <p className="mb-2 text-sm text-rose-600">{editErr}</p>}

              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEdit(null)}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={saving}
                  className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? "Speichert …" : "Speichern"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
