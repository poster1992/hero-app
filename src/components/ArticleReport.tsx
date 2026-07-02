"use client";

import { Fragment, useMemo, useState } from "react";

export interface ArticleRow {
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

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const num = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat("de-DE");

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

type SortKey = "article" | "qty" | "amount" | "count";

interface Group {
  key: string;
  label: string;
  rows: ArticleRow[];
  totalQty: number;
  unit: string; // gemeinsame Einheit oder "gemischt"
  totalAmount: number;
  suppliers: number;
}

function BelegLink({ number, url }: { number: string; url: string | null }) {
  if (!url) return <span className="text-gray-500">{number || "—"}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Beleg (PDF) öffnen" className="whitespace-nowrap font-medium text-brand-red hover:underline">
      {number || "Beleg"} 📄
    </a>
  );
}

export default function ArticleReport({ rows }: { rows: ArticleRow[] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("amount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const src = q
      ? rows.filter((r) => r.article.toLowerCase().includes(q) || r.supplier.toLowerCase().includes(q))
      : rows;
    const byKey = new Map<string, ArticleRow[]>();
    for (const r of src) (byKey.get(norm(r.article)) ?? byKey.set(norm(r.article), []).get(norm(r.article))!).push(r);

    const out: Group[] = [];
    for (const [key, gr] of byKey) {
      const units = new Set(gr.map((r) => (r.unit || "").toLowerCase()).filter(Boolean));
      const unit = units.size === 1 ? gr.find((r) => r.unit)?.unit ?? "" : units.size === 0 ? "" : "gemischt";
      const totalQty = gr.reduce((s, r) => s + (r.quantity || 0), 0);
      const totalAmount = gr.reduce((s, r) => s + (r.lineTotal || 0), 0);
      const freq = new Map<string, number>();
      for (const r of gr) freq.set(r.article, (freq.get(r.article) ?? 0) + 1);
      const label = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
      out.push({ key, label, rows: gr, totalQty, unit, totalAmount, suppliers: new Set(gr.map((r) => r.supplier)).size });
    }
    return out;
  }, [rows, search]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (g: Group): string | number => {
      switch (sortKey) {
        case "article": return g.label.toLowerCase();
        case "qty": return g.totalQty;
        case "amount": return g.totalAmount;
        case "count": return g.rows.length;
        default: return 0;
      }
    };
    return [...groups].sort((a, b) => {
      const va = val(a), vb = val(b);
      return (typeof va === "string" || typeof vb === "string" ? String(va).localeCompare(String(vb), "de") : va - vb) * dir;
    });
  }, [groups, sortKey, sortDir]);

  const grandTotal = useMemo(() => groups.reduce((s, g) => s + g.totalAmount, 0), [groups]);

  const sortBy = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "article" ? "asc" : "desc");
    }
  };
  const toggle = (k: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const Th = ({ k, label, cls = "" }: { k: SortKey; label: string; cls?: string }) => (
    <th className={`px-3 py-2 font-medium ${cls}`}>
      <button type="button" onClick={() => sortBy(k)} className="inline-flex items-center gap-1 hover:text-gray-900">
        {label}
        <span className="text-gray-400">{sortKey === k ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );

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
        <span className="ml-auto text-sm text-gray-500">
          {sorted.length} Artikel · Summe {eur.format(grandTotal)}
        </span>
      </div>

      <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-500">
            Noch keine ausgelesenen Beleg-Artikel. Belege zuerst unter „Belege" indexieren.
          </p>
        ) : (
          <div className="max-h-[calc(100vh-15rem)] overflow-auto">
            <table className="w-full min-w-[820px] text-left text-xs">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-gray-700 [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:border-b-2 [&>th]:border-white/10 [&>th]:bg-[#191c20]">
                  <Th k="article" label="Artikel" />
                  <Th k="qty" label="Gesamtmenge" cls="text-right" />
                  <Th k="amount" label="Gesamtbetrag" cls="text-right" />
                  <Th k="count" label="Belege" cls="text-center" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((g) => {
                  const open = expanded.has(g.key);
                  return (
                    <Fragment key={g.key}>
                      <tr onClick={() => toggle(g.key)} className="cursor-pointer border-b border-gray-200 hover:bg-gray-100">
                        <td className="px-3 py-2 align-top font-medium text-gray-800">
                          <span className="mr-1 text-gray-400">{open ? "▾" : "▸"}</span>
                          {g.label}
                        </td>
                        <td className="px-3 py-2 text-right align-top whitespace-nowrap text-gray-800">
                          {num.format(g.totalQty)} {g.unit || ""}
                        </td>
                        <td className="px-3 py-2 text-right align-top whitespace-nowrap font-semibold text-gray-900">
                          {eur.format(g.totalAmount)}
                        </td>
                        <td className="px-3 py-2 text-center align-top whitespace-nowrap text-gray-600">
                          {g.rows.length} · {g.suppliers} Lief.
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-gray-50/60">
                          <td colSpan={4} className="px-3 py-2">
                            <table className="w-full text-[11px]">
                              <thead>
                                <tr className="text-gray-500">
                                  <th className="px-2 py-1 text-left font-medium">Datum</th>
                                  <th className="px-2 py-1 text-left font-medium">Lieferant</th>
                                  <th className="px-2 py-1 text-right font-medium">Menge</th>
                                  <th className="px-2 py-1 text-right font-medium">Einzelpreis</th>
                                  <th className="px-2 py-1 text-right font-medium">Betrag</th>
                                  <th className="px-2 py-1 text-left font-medium">Beleg</th>
                                </tr>
                              </thead>
                              <tbody>
                                {g.rows
                                  .slice()
                                  .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
                                  .map((r, i) => (
                                    <tr key={`${g.key}-${i}`} className="border-t border-gray-200/70">
                                      <td className="px-2 py-1 whitespace-nowrap text-gray-500">{r.date ? dateFmt.format(new Date(r.date)) : "—"}</td>
                                      <td className="px-2 py-1 text-gray-700">{r.supplier}</td>
                                      <td className="px-2 py-1 text-right whitespace-nowrap text-gray-700">{num.format(r.quantity)} {r.unit || ""}</td>
                                      <td className="px-2 py-1 text-right whitespace-nowrap text-gray-700">{r.unitPrice > 0 ? eur.format(r.unitPrice) : "—"}</td>
                                      <td className="px-2 py-1 text-right whitespace-nowrap font-medium text-gray-900">{eur.format(r.lineTotal)}</td>
                                      <td className="px-2 py-1 whitespace-nowrap"><BelegLink number={r.number} url={r.docUrl} /></td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-xs text-gray-400">
        Artikel werden anhand der Bezeichnung gruppiert. „Gemischt" bei der Einheit bedeutet, dass
        derselbe Artikel mit unterschiedlichen Einheiten ausgelesen wurde – dann ist die Mengensumme
        nur bedingt aussagekräftig.
      </p>
    </div>
  );
}
