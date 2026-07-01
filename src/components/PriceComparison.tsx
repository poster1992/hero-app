"use client";

import { useMemo, useState } from "react";

export interface PriceRow {
  article: string;
  supplier: string;
  date: string | null;
  number: string;
  heroReceiptId: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  lineTotal: number;
}

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const num = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat("de-DE");

/** Normalisierter Artikelschlüssel für die Gruppierung gleicher Artikel. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

type SortKey = "article" | "supplier" | "date" | "quantity" | "unitPrice" | "delta";

export default function PriceComparison({ rows }: { rows: PriceRow[] }) {
  const [search, setSearch] = useState("");
  const [onlyComparable, setOnlyComparable] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("article");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Günstigster Einzelpreis + Anzahl Vorkommen je (normalisiertem) Artikel.
  const stats = useMemo(() => {
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
      const set = suppliers.get(k) ?? new Set<string>();
      set.add(r.supplier);
      suppliers.set(k, set);
    }
    return { min, count, suppliers };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows;
    if (q) list = list.filter((r) => r.article.toLowerCase().includes(q) || r.supplier.toLowerCase().includes(q));
    if (onlyComparable) {
      list = list.filter((r) => {
        const k = norm(r.article);
        return (stats.count.get(k) ?? 0) > 1 && (stats.suppliers.get(k)?.size ?? 0) > 1;
      });
    }
    return list;
  }, [rows, search, onlyComparable, stats]);

  const deltaPct = (r: PriceRow): number => {
    const m = stats.min.get(norm(r.article));
    if (!m || m <= 0 || r.unitPrice <= 0) return 0;
    return (r.unitPrice / m - 1) * 100;
  };

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
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
    return [...filtered].sort((a, b) => {
      // Primär nach gewählter Spalte; bei "article" innerhalb der Gruppe nach Preis aufsteigend.
      const va = val(a);
      const vb = val(b);
      let c: number;
      if (typeof va === "string" || typeof vb === "string") c = String(va).localeCompare(String(vb), "de") * dir;
      else c = (va - vb) * dir;
      if (c !== 0) return c;
      if (sortKey === "article") return a.unitPrice - b.unitPrice;
      return 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir, stats]);

  const sortBy = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "unitPrice" || k === "delta" || k === "quantity" ? "desc" : "asc");
    }
  };

  const Th = ({ k, label, cls = "" }: { k: SortKey; label: string; cls?: string }) => (
    <th className={`px-3 py-2 font-medium ${cls}`}>
      <button type="button" onClick={() => sortBy(k)} className="inline-flex items-center gap-1 transition-colors hover:text-gray-900">
        {label}
        <span className="text-gray-400">{sortKey === k ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );

  const distinctArticles = stats.min.size + [...stats.count.keys()].filter((k) => !stats.min.has(k)).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Artikel oder Lieferant suchen …"
          className="w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-red focus:outline-none"
        />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={onlyComparable} onChange={(e) => setOnlyComparable(e.target.checked)} />
          Nur vergleichbare (mehrere Lieferanten)
        </label>
        <span className="ml-auto text-sm text-gray-500">
          {filtered.length} Positionen · {distinctArticles} Artikel
        </span>
      </div>

      <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-500">
            Noch keine ausgelesenen Beleg-Artikel. Belege zuerst unter „Belege" indexieren.
          </p>
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
                {sorted.map((r, i) => {
                  const k = norm(r.article);
                  const min = stats.min.get(k);
                  const isCheapest = min != null && r.unitPrice > 0 && r.unitPrice <= min + 1e-9;
                  const comparable = (stats.count.get(k) ?? 0) > 1;
                  const pct = deltaPct(r);
                  return (
                    <tr key={`${r.heroReceiptId}-${i}`} className="border-b border-gray-200 last:border-0 hover:bg-gray-100">
                      <td className="px-3 py-2 align-top font-medium text-gray-800">{r.article}</td>
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
                        {!comparable ? (
                          <span className="text-gray-400">einzeln</span>
                        ) : isCheapest ? (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                            ★ günstigster
                          </span>
                        ) : pct > 0 ? (
                          <span className="font-medium text-brand-red">+{num.format(pct)} %</span>
                        ) : (
                          "—"
                        )}
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
        Hinweis: Artikel werden anhand ihrer Bezeichnung gruppiert. Unterschiedliche Schreibweisen
        desselben Artikels können getrennt erscheinen. „Nur vergleichbare" zeigt Artikel, die bei
        mehreren Lieferanten vorkommen.
      </p>
    </div>
  );
}
