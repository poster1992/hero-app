"use client";

import { Fragment, useMemo, useState } from "react";

export interface PriceRow {
  article: string;
  supplier: string;
  date: string | null;
  number: string;
  heroReceiptId: string;
  docUrl: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  lineTotal: number;
}

/** 📄-Link zum Beleg-PDF (öffnet neuen Tab). */
function BelegLink({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="Beleg (PDF) öffnen"
      onClick={(e) => e.stopPropagation()}
      className="ml-1.5 inline-block align-middle text-brand-red hover:opacity-80"
    >
      📄
    </a>
  );
}

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const num = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat("de-DE");

/** Exakter Normalschlüssel (nur Groß/Klein + Leerraum). */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

const UNIT_TOKENS = new Set([
  "mm", "cm", "dm", "m", "m2", "m²", "qm", "lfm", "lm", "kg", "g", "l", "ml", "stk", "st", "stück",
  "stueck", "pak", "paket", "kan", "rolle", "set", "paar", "vpe", "karton", "eur", "flasc", "flasche",
]);

/** Unschärfe-Schlüssel: signifikante Wörter/Codes (ohne Maße, Zahlen, Einheiten), sortiert. */
function similarKey(name: string): string {
  const toks = name
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => {
      if (UNIT_TOKENS.has(t)) return false;
      if (/^\d+([.,]\d+)?$/.test(t)) return false; // reine Zahl
      if (/^\d+([.,]\d+)?(x\d+([.,]\d+)?)+/.test(t)) return false; // Maße wie 1200x600x18
      if (/^\d+([.,]\d+)?(mm|cm|m|qm|kg|g|l|ml)$/.test(t)) return false; // 8mm, 800g
      return t.length >= 3;
    });
  const uniq = Array.from(new Set(toks)).sort();
  return uniq.slice(0, 6).join(" ") || norm(name);
}

type SortKey = "article" | "supplier" | "date" | "quantity" | "unitPrice" | "delta";

interface Group {
  key: string;
  label: string;
  rows: PriceRow[];
  min: number;
  max: number;
  avg: number;
  cheapest: PriceRow | null;
  suppliers: number;
  savings: number;
}

export default function PriceComparison({ rows }: { rows: PriceRow[] }) {
  const [search, setSearch] = useState("");
  const [onlyComparable, setOnlyComparable] = useState(false);
  const [grouped, setGrouped] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("article");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Günstigster Einzelpreis + Vorkommen je EXAKTER Bezeichnung (für die Positionsansicht).
  const exact = useMemo(() => {
    const min = new Map<string, number>();
    const count = new Map<string, number>();
    const suppliers = new Map<string, Set<string>>();
    for (const r of rows) {
      const k = norm(r.article);
      count.set(k, (count.get(k) ?? 0) + 1);
      if (r.unitPrice > 0) {
        const m = min.get(k);
        if (m == null || r.unitPrice < m) min.set(k, r.unitPrice);
      }
      (suppliers.get(k) ?? suppliers.set(k, new Set()).get(k)!).add(r.supplier);
    }
    return { min, count, suppliers };
  }, [rows]);

  const searchFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.article.toLowerCase().includes(q) || r.supplier.toLowerCase().includes(q));
  }, [rows, search]);

  // Gruppen nach ähnlicher Bezeichnung.
  const groups = useMemo(() => {
    const byKey = new Map<string, PriceRow[]>();
    for (const r of searchFiltered) {
      const k = similarKey(r.article);
      (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(r);
    }
    const out: Group[] = [];
    for (const [key, gr] of byKey) {
      const priced = gr.filter((r) => r.unitPrice > 0);
      const min = priced.length ? Math.min(...priced.map((r) => r.unitPrice)) : 0;
      const max = priced.length ? Math.max(...priced.map((r) => r.unitPrice)) : 0;
      const avg = priced.length ? priced.reduce((s, r) => s + r.unitPrice, 0) / priced.length : 0;
      const cheapest = priced.length ? priced.reduce((a, b) => (b.unitPrice < a.unitPrice ? b : a)) : null;
      const suppliers = new Set(gr.map((r) => r.supplier)).size;
      const savings = min > 0 ? gr.reduce((s, r) => s + Math.max(0, (r.unitPrice - min) * (r.quantity || 0)), 0) : 0;
      // Anzeigename: häufigste exakte Bezeichnung.
      const freq = new Map<string, number>();
      for (const r of gr) freq.set(r.article, (freq.get(r.article) ?? 0) + 1);
      const label = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
      out.push({ key, label, rows: gr, min, max, avg, cheapest, suppliers, savings });
    }
    return out;
  }, [searchFiltered]);

  // --- Positionsansicht (flach) ---
  const flatRows = useMemo(() => {
    let list = searchFiltered;
    if (onlyComparable) {
      list = list.filter((r) => {
        const k = norm(r.article);
        return (exact.count.get(k) ?? 0) > 1 && (exact.suppliers.get(k)?.size ?? 0) > 1;
      });
    }
    const dir = sortDir === "asc" ? 1 : -1;
    const deltaPct = (r: PriceRow) => {
      const m = exact.min.get(norm(r.article));
      return !m || m <= 0 || r.unitPrice <= 0 ? 0 : (r.unitPrice / m - 1) * 100;
    };
    const val = (r: PriceRow): string | number => {
      switch (sortKey) {
        case "article": return norm(r.article);
        case "supplier": return r.supplier.toLowerCase();
        case "date": return r.date ?? "";
        case "quantity": return r.quantity;
        case "unitPrice": return r.unitPrice;
        case "delta": return deltaPct(r);
        default: return 0;
      }
    };
    return [...list].sort((a, b) => {
      const va = val(a), vb = val(b);
      let c = typeof va === "string" || typeof vb === "string" ? String(va).localeCompare(String(vb), "de") * dir : (va - vb) * dir;
      if (c === 0 && sortKey === "article") c = a.unitPrice - b.unitPrice;
      return c;
    });
  }, [searchFiltered, onlyComparable, sortKey, sortDir, exact]);

  const visibleGroups = useMemo(() => {
    let list = groups;
    if (onlyComparable) list = list.filter((g) => g.rows.length > 1 && g.suppliers > 1);
    return [...list].sort((a, b) => b.savings - a.savings || a.label.localeCompare(b.label, "de"));
  }, [groups, onlyComparable]);

  const sortBy = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "unitPrice" || k === "delta" || k === "quantity" ? "desc" : "asc");
    }
  };
  const toggleGroup = (k: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const Th = ({ k, label, cls = "" }: { k: SortKey; label: string; cls?: string }) => (
    <th className={`px-3 py-2 font-medium ${cls}`}>
      <button type="button" onClick={() => sortBy(k)} className="inline-flex items-center gap-1 transition-colors hover:text-gray-900">
        {label}
        <span className="text-gray-400">{sortKey === k ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );

  const deltaCell = (r: PriceRow, min: number | undefined, comparable: boolean) => {
    if (!comparable) return <span className="text-gray-400">einzeln</span>;
    if (min != null && r.unitPrice > 0 && r.unitPrice <= min + 1e-9)
      return <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">★ günstigster</span>;
    const pct = min && min > 0 && r.unitPrice > 0 ? (r.unitPrice / min - 1) * 100 : 0;
    return pct > 0 ? <span className="font-medium text-brand-red">+{num.format(pct)} %</span> : <span>—</span>;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Artikel oder Lieferant suchen …"
          className="w-full max-w-sm rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-red focus:outline-none"
        />
        {/* Umschalter Positionen / Gruppiert */}
        <div className="flex overflow-hidden rounded-md border border-gray-300 text-xs">
          {[
            { v: false, label: "Positionen" },
            { v: true, label: "Ähnliche gruppieren" },
          ].map((o) => (
            <button
              key={String(o.v)}
              type="button"
              onClick={() => setGrouped(o.v)}
              className={`px-3 py-1.5 font-medium ${grouped === o.v ? "bg-brand-red text-white" : "text-gray-600 hover:bg-gray-100"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={onlyComparable} onChange={(e) => setOnlyComparable(e.target.checked)} />
          Nur vergleichbare (mehrere Lieferanten)
        </label>
        <span className="ml-auto text-sm text-gray-500">
          {grouped ? `${visibleGroups.length} Artikelgruppen` : `${flatRows.length} Positionen`}
        </span>
      </div>

      <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-500">
            Noch keine ausgelesenen Beleg-Artikel. Belege zuerst unter „Belege" indexieren.
          </p>
        ) : grouped ? (
          <div className="max-h-[calc(100vh-15rem)] overflow-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-gray-700 [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:border-b-2 [&>th]:border-white/10 [&>th]:bg-[#191c20]">
                  <th className="px-3 py-2 font-medium">Artikel (Gruppe)</th>
                  <th className="px-3 py-2 text-center font-medium">Positionen · Lieferanten</th>
                  <th className="px-3 py-2 text-right font-medium">Günstigster</th>
                  <th className="px-3 py-2 text-right font-medium">Teuerster</th>
                  <th className="px-3 py-2 text-right font-medium">Ø</th>
                  <th className="px-3 py-2 text-right font-medium">Sparpotenzial</th>
                </tr>
              </thead>
              <tbody>
                {visibleGroups.map((g) => {
                  const open = expanded.has(g.key);
                  return (
                    <Fragment key={g.key}>
                      <tr
                        onClick={() => toggleGroup(g.key)}
                        className="cursor-pointer border-b border-gray-200 hover:bg-gray-100"
                      >
                        <td className="px-3 py-2 align-top font-medium text-gray-800">
                          <span className="mr-1 text-gray-400">{open ? "▾" : "▸"}</span>
                          {g.label}
                        </td>
                        <td className="px-3 py-2 text-center align-top whitespace-nowrap text-gray-600">
                          {g.rows.length} · {g.suppliers}
                        </td>
                        <td className="px-3 py-2 text-right align-top whitespace-nowrap">
                          {g.cheapest ? (
                            <span>
                              <span className="font-semibold text-emerald-700">{eur.format(g.min)}</span>
                              <span className="block text-[11px] text-gray-500">{g.cheapest.supplier}</span>
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right align-top whitespace-nowrap text-gray-700">
                          {g.max > 0 ? eur.format(g.max) : "—"}
                          {g.max > 0 && g.min > 0 && g.max > g.min ? (
                            <span className="block text-[11px] text-brand-red">+{num.format((g.max / g.min - 1) * 100)} %</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right align-top whitespace-nowrap text-gray-600">
                          {g.avg > 0 ? eur.format(g.avg) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right align-top whitespace-nowrap font-medium text-gray-900">
                          {g.savings > 0 ? eur.format(g.savings) : "—"}
                        </td>
                      </tr>
                      {open &&
                        g.rows
                          .slice()
                          .sort((a, b) => a.unitPrice - b.unitPrice)
                          .map((r, i) => (
                            <tr key={`${g.key}-${i}`} className="border-b border-gray-100 bg-gray-50/60 text-[11px]">
                              <td className="px-3 py-1.5 pl-8 align-top text-gray-700">
                                {r.article}
                                <BelegLink url={r.docUrl} />
                              </td>
                              <td className="px-3 py-1.5 text-center align-top text-gray-600">{r.supplier}</td>
                              <td className="px-3 py-1.5 text-right align-top whitespace-nowrap">
                                {deltaCell(r, g.min, g.rows.length > 1)}
                              </td>
                              <td className="px-3 py-1.5 text-right align-top whitespace-nowrap font-medium text-gray-900">
                                {r.unitPrice > 0 ? eur.format(r.unitPrice) : "—"}
                              </td>
                              <td className="px-3 py-1.5 text-right align-top whitespace-nowrap text-gray-500">
                                {r.quantity ? `${num.format(r.quantity)}${r.unit ? " " + r.unit : ""}` : ""}
                              </td>
                              <td className="px-3 py-1.5 text-right align-top whitespace-nowrap text-gray-400">
                                {r.date ? dateFmt.format(new Date(r.date)) : ""}
                              </td>
                            </tr>
                          ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="max-h-[calc(100vh-15rem)] overflow-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-gray-700 [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:border-b-2 [&>th]:border-white/10 [&>th]:bg-[#191c20]">
                  <Th k="article" label="Artikel" />
                  <Th k="supplier" label="Lieferant" />
                  <Th k="date" label="Datum" />
                  <Th k="quantity" label="Menge" cls="text-right" />
                  <Th k="unitPrice" label="Einzelpreis (EK)" cls="text-right" />
                  <Th k="delta" label="vs. günstigster" cls="text-right" />
                  <th className="px-3 py-2 font-medium">Beleg</th>
                </tr>
              </thead>
              <tbody>
                {flatRows.map((r, i) => {
                  const k = norm(r.article);
                  const comparable = (exact.count.get(k) ?? 0) > 1;
                  return (
                    <tr key={`${r.heroReceiptId}-${i}`} className="border-b border-gray-200 last:border-0 hover:bg-gray-100">
                      <td className="px-3 py-2 align-top font-medium text-gray-800">
                        {r.article}
                        <BelegLink url={r.docUrl} />
                      </td>
                      <td className="px-3 py-2 align-top text-gray-700">{r.supplier}</td>
                      <td className="px-3 py-2 align-top whitespace-nowrap text-gray-600">
                        {r.date ? dateFmt.format(new Date(r.date)) : "—"}
                      </td>
                      <td className="px-3 py-2 align-top text-right whitespace-nowrap text-gray-700">
                        {r.quantity ? `${num.format(r.quantity)}${r.unit ? " " + r.unit : ""}` : "—"}
                      </td>
                      <td className="px-3 py-2 align-top text-right whitespace-nowrap font-medium text-gray-900">
                        {r.unitPrice > 0 ? eur.format(r.unitPrice) : "—"}
                      </td>
                      <td className="px-3 py-2 align-top text-right whitespace-nowrap">
                        {deltaCell(r, exact.min.get(k), comparable)}
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap text-gray-500">{r.number || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-xs text-gray-400">
        „Positionen" listet jede Beleg-Position; günstigster Preis je exakter Bezeichnung markiert.
        „Ähnliche gruppieren" fasst ähnliche Bezeichnungen (Kernwörter/Codes, ohne Maße/Einheiten)
        zusammen – Zeile aufklappen zeigt die Einzelpositionen. Sparpotenzial = Summe der Mehrkosten
        gegenüber dem günstigsten Einzelpreis der Gruppe.
      </p>
    </div>
  );
}
