"use client";

import { useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { StockMovement } from "@/lib/material-types";
import type { OutboundStatRow, MissingEkArticle } from "@/lib/materials";
import {
  deleteMovementAction,
  updateMovementAction,
  getOutboundStatsAction,
  setMaterialEkAction,
} from "@/app/dashboard/lager/actions";

export interface MovementProjectOption {
  relativeId: number | null;
  name: string;
}

const numberFmt = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const currencyFmt = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

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

/** Eindeutiger Projekt-Schlüssel einer Statistik-Zeile (identisch zur Server-Aggregation). */
const projKey = (r: OutboundStatRow) =>
  r.projectRelativeId != null ? `#${r.projectRelativeId}` : r.projectName ?? "—";
function projLabel(r: OutboundStatRow): string {
  if (r.projectName) return `${r.projectRelativeId != null ? `#${r.projectRelativeId} ` : ""}${r.projectName}`;
  return r.projectRelativeId != null ? `#${r.projectRelativeId}` : "Ohne Projekt";
}

type Filter = "all" | "in" | "out";

/**
 * Nachtrag-Zeile: EK eines ausgebuchten Artikels eintragen. Der Preis wird am
 * Artikel gespeichert UND auf alle bisherigen Buchungen ohne EK übertragen
 * (`setMaterialEkAction` → `setMaterialEkByArticle`), sodass Lagerausgang und
 * Statistik den Wert rückwirkend zeigen.
 */
function MissingEkRow({ a }: { a: MissingEkArticle }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(a.ekPrice > 0 ? String(a.ekPrice).replace(".", ",") : "");
  const [done, setDone] = useState(false);

  const save = () => {
    const price = Number(value.replace(",", "."));
    if (!Number.isFinite(price) || price <= 0) return;
    const fd = new FormData();
    fd.set("heroArticleId", String(a.heroArticleId));
    fd.set("price", value);
    start(async () => {
      await setMaterialEkAction(fd);
      setDone(true);
      router.refresh();
    });
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <span className="font-medium text-gray-900">{a.name}</span>
        {a.sku && <span className="text-gray-500"> · {a.sku}</span>}
        <span className="block text-xs text-gray-500">
          {numberFmt.format(a.qty)} {a.unit} ohne EK ausgebucht · {a.bookings}{" "}
          {a.bookings === 1 ? "Buchung" : "Buchungen"}
          {a.lastAt ? ` · zuletzt ${formatDateTime(a.lastAt)}` : ""}
          {a.ekPrice > 0
            ? ` · Artikel-EK ${currencyFmt.format(a.ekPrice)} (nur die Buchungen fehlen)`
            : ""}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {done ? (
          <span className="text-xs font-medium text-emerald-700">✓ übertragen</span>
        ) : (
          <>
            <input
              type="text"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
              }}
              placeholder="EK 0,00"
              title={`EK-Preis je ${a.unit} – wird auf die ${a.bookings} Buchung(en) ohne EK übertragen`}
              className="w-24 rounded-md border border-brand-red/50 bg-brand-red/5 px-2 py-1 text-right text-sm outline-none focus:border-brand-red/60"
            />
            <button
              type="button"
              onClick={save}
              disabled={pending || !value.trim()}
              className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 transition-colors hover:border-brand-red/50 disabled:opacity-50"
            >
              {pending ? "…" : "✓"}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

/** Kasten „Ausbuchungen ohne EK-Preis" mit Nachtrag-Feldern je Artikel. */
function MissingEkPanel({ items }: { items: MissingEkArticle[] }) {
  const [open, setOpen] = useState(true);
  const bookings = items.reduce((s, a) => s + a.bookings, 0);

  return (
    <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-sm font-semibold text-amber-900">
          ⚠ Ausbuchungen ohne EK-Preis · {items.length} {items.length === 1 ? "Artikel" : "Artikel"} ·{" "}
          {bookings} {bookings === 1 ? "Buchung" : "Buchungen"}
        </span>
        <span className="shrink-0 text-xs font-medium text-amber-800">{open ? "▲ einklappen" : "▼ anzeigen"}</span>
      </button>
      {open && (
        <>
          <p className="mt-1 text-xs text-amber-900/80">
            Diese Artikel wurden ohne hinterlegten Einkaufspreis ausgebucht und zählen im Lagerausgang
            mit 0 €. EK hier nachtragen – er wird am Artikel gespeichert und automatisch auf alle
            betroffenen Buchungen übertragen.
          </p>
          <ul className="mt-2 divide-y divide-amber-200/70">
            {items.map((a) => (
              <MissingEkRow key={a.heroArticleId} a={a} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Buchungs-Historie (eigene Lager-Unterseite): die letzten Ein-/Ausbuchungen, filterbar. */
export default function LagerMovements({
  movements,
  isAdmin = false,
  canStats = false,
  canEk = false,
  missingEk = [],
  projects = [],
}: {
  movements: StockMovement[];
  isAdmin?: boolean;
  /** Recht „lager_statistik": zeigt den Button „Lagerstatistik". */
  canStats?: boolean;
  /** Recht „lager_ek": zeigt EK-Werte und erlaubt das Nachtragen fehlender Preise. */
  canEk?: boolean;
  /** Ausgebuchte Artikel, deren Buchungen ohne EK stehen (zum Nachtragen). */
  missingEk?: MissingEkArticle[];
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

  // --- Lagerstatistik (Ausbuchungen) ---
  const [statsOpen, setStatsOpen] = useState(false);
  const [statsRows, setStatsRows] = useState<OutboundStatRow[] | null>(null);
  const [statsLoading, startStats] = useTransition();
  const [statsMode, setStatsMode] = useState<"total" | "day">("total");
  const [statsDay, setStatsDay] = useState("");
  const [statsProject, setStatsProject] = useState(""); // "" = alle Projekte
  const [statsSearch, setStatsSearch] = useState("");

  const openStats = () => {
    setStatsOpen(true);
    if (statsRows == null) {
      startStats(async () => {
        const rows = await getOutboundStatsAction();
        setStatsRows(rows);
        const days = [...new Set(rows.map((r) => r.day))].sort((a, b) => b.localeCompare(a));
        if (days[0]) setStatsDay(days[0]);
      });
    }
  };

  const statsDays = useMemo(
    () => [...new Set((statsRows ?? []).map((r) => r.day))].sort((a, b) => b.localeCompare(a)),
    [statsRows]
  );

  // Aggregiert eine Zeilenmenge je Artikel (Menge/Wert/Buchungen), absteigend nach Menge.
  const aggregate = (rows: OutboundStatRow[]) => {
    const m = new Map<string, { name: string; unit: string; qty: number; value: number; bookings: number }>();
    for (const r of rows) {
      const e = m.get(r.name) ?? { name: r.name, unit: r.unit, qty: 0, value: 0, bookings: 0 };
      e.qty = Math.round((e.qty + r.qty) * 100) / 100;
      e.value = Math.round((e.value + r.value) * 100) / 100;
      e.bookings += r.bookings;
      m.set(r.name, e);
    }
    return [...m.values()].sort((a, b) => b.qty - a.qty);
  };

  // Im Statistik-Modal auswählbare Projekte (nur solche, die in Ausbuchungen vorkommen).
  const statsProjects = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of statsRows ?? []) m.set(projKey(r), projLabel(r));
    return [...m.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label, "de"));
  }, [statsRows]);

  // Nach gewähltem Projekt vorfiltern (leer = alle Projekte).
  const projFiltered = useMemo(
    () => (statsProject ? (statsRows ?? []).filter((r) => projKey(r) === statsProject) : statsRows ?? []),
    [statsRows, statsProject]
  );

  const statsTotal = useMemo(() => aggregate(projFiltered), [projFiltered]);
  const statsForDay = useMemo(
    () => aggregate(projFiltered.filter((r) => r.day === statsDay)),
    [projFiltered, statsDay]
  );
  const statsAggregated = statsMode === "day" ? statsForDay : statsTotal;
  // Artikel-Suche über die (aggregierte) Anzeige.
  const statsRowsShown = statsSearch.trim()
    ? statsAggregated.filter((r) => r.name.toLowerCase().includes(statsSearch.trim().toLowerCase()))
    : statsAggregated;
  const statsSum = statsRowsShown.reduce((s, r) => s + r.value, 0);

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
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-900">Letzte Buchungen</h2>
          {canStats && (
            <button
              type="button"
              onClick={openStats}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
            >
              📊 Lagerstatistik
            </button>
          )}
        </div>
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

      {canEk && missingEk.length > 0 && <MissingEkPanel items={missingEk} />}

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
              <div className="min-w-0 flex-1">
                <span className={`mr-2 font-semibold tabular-nums ${mv.delta >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                  {mv.delta >= 0 ? "+" : ""}
                  {numberFmt.format(mv.delta)}
                </span>
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
                  {/* EK-Wert der Buchung – fehlender Preis wird deutlich markiert. */}
                  {canEk && mv.delta < 0 && (
                    mv.ekPrice && mv.ekPrice > 0 ? (
                      <span className="text-gray-500">
                        {" · "}
                        {currencyFmt.format(Math.abs(mv.delta) * mv.ekPrice)}
                        <span className="text-gray-400"> ({currencyFmt.format(mv.ekPrice)} EK)</span>
                      </span>
                    ) : (
                      <span className="ml-1.5 whitespace-nowrap rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-500/40">
                        kein EK
                      </span>
                    )
                  )}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
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

      {statsOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
            onClick={() => setStatsOpen(false)}
          >
            <div
              className="my-8 w-full max-w-xl border border-line bg-white p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-gray-900">Lagerstatistik · Ausbuchungen</h2>
                <button type="button" onClick={() => setStatsOpen(false)} className="text-gray-400 hover:text-gray-700" aria-label="Schließen">
                  ✕
                </button>
              </div>

              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-md border border-gray-300 p-0.5">
                  <button
                    type="button"
                    onClick={() => setStatsMode("total")}
                    className={statsMode === "total" ? "rounded bg-brand-red px-3 py-1 text-sm font-medium text-white" : "px-3 py-1 text-sm text-gray-600"}
                  >
                    Gesamt
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatsMode("day")}
                    className={statsMode === "day" ? "rounded bg-brand-red px-3 py-1 text-sm font-medium text-white" : "px-3 py-1 text-sm text-gray-600"}
                  >
                    Nach Tag
                  </button>
                </div>
                {statsMode === "day" && (
                  <select
                    value={statsDay}
                    onChange={(e) => setStatsDay(e.target.value)}
                    className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    {statsDays.length === 0 ? (
                      <option value="">—</option>
                    ) : (
                      statsDays.map((d) => (
                        <option key={d} value={d}>
                          {d.split("-").reverse().join(".")}
                        </option>
                      ))
                    )}
                  </select>
                )}
                {statsProjects.length > 0 && (
                  <select
                    value={statsProject}
                    onChange={(e) => setStatsProject(e.target.value)}
                    title="Nach Projekt filtern"
                    className="max-w-[16rem] rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">Alle Projekte</option>
                    {statsProjects.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <input
                type="search"
                value={statsSearch}
                onChange={(e) => setStatsSearch(e.target.value)}
                placeholder="Artikel suchen …"
                className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60"
              />

              {statsLoading && statsRows == null ? (
                <p className="py-6 text-center text-sm text-gray-500">Wird geladen …</p>
              ) : statsRowsShown.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-500">
                  {statsSearch.trim()
                    ? "Kein Artikel gefunden."
                    : `Keine Ausbuchungen${statsMode === "day" ? " an diesem Tag" : ""}.`}
                </p>
              ) : (
                <div className="max-h-[55vh] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-300 text-xs uppercase tracking-wide text-gray-500">
                        <th className="py-2 pr-3 text-left font-medium">Artikel</th>
                        <th className="py-2 px-3 text-right font-medium">Menge raus</th>
                        <th className="py-2 px-3 text-right font-medium">Wert (EK)</th>
                        <th className="py-2 pl-3 text-right font-medium">Buchungen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statsRowsShown.map((r) => (
                        <tr key={r.name} className="border-b border-gray-100">
                          <td className="py-1.5 pr-3 text-gray-800">{r.name}</td>
                          <td className="whitespace-nowrap py-1.5 px-3 text-right font-medium tabular-nums text-rose-600">
                            {numberFmt.format(r.qty)}{r.unit ? ` ${r.unit}` : ""}
                          </td>
                          <td className="py-1.5 px-3 text-right tabular-nums text-gray-700">{currencyFmt.format(r.value)}</td>
                          <td className="py-1.5 pl-3 text-right tabular-nums text-gray-500">{r.bookings}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-300 font-semibold">
                        <td className="py-2 pr-3 text-gray-700">Summe ({statsRowsShown.length} Artikel)</td>
                        <td />
                        <td className="py-2 px-3 text-right tabular-nums text-brand-red">{currencyFmt.format(statsSum)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>,
          document.body
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
