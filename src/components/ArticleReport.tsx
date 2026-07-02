"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mergeArticlesAction, unmergeArticlesAction } from "@/app/dashboard/artikel-auswertung/actions";
import type { MergeInfo } from "@/lib/article-merges";

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
  return s.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 191);
}

type SortKey = "article" | "supplier" | "qty" | "amount" | "count";

interface Group {
  key: string;
  label: string;
  rows: ArticleRow[];
  totalQty: number;
  unit: string;
  totalAmount: number;
  suppliers: number;
  supplierList: string[];
  merged: boolean;
}

function BelegLink({ number, url }: { number: string; url: string | null }) {
  if (!url) return <span className="text-gray-500">{number || "—"}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Beleg (PDF) öffnen" className="whitespace-nowrap font-medium text-brand-red hover:underline">
      {number || "Beleg"} 📄
    </a>
  );
}

export default function ArticleReport({ rows, merges }: { rows: ArticleRow[]; merges: Record<string, MergeInfo> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("amount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeOpen, setMergeOpen] = useState(false);
  const [canonical, setCanonical] = useState<string>("");

  // Zusammenführung: Schlüssel auf Ziel abbilden.
  const targetLabelByKey = useMemo(() => {
    const m: Record<string, string> = {};
    for (const info of Object.values(merges)) m[info.targetKey] = info.targetLabel;
    return m;
  }, [merges]);
  const resolve = (name: string) => merges[norm(name)]?.targetKey ?? norm(name);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const src = q
      ? rows.filter((r) => r.article.toLowerCase().includes(q) || r.supplier.toLowerCase().includes(q))
      : rows;
    const byKey = new Map<string, ArticleRow[]>();
    for (const r of src) {
      const k = resolve(r.article);
      (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(r);
    }
    const out: Group[] = [];
    for (const [key, gr] of byKey) {
      const units = new Set(gr.map((r) => (r.unit || "").toLowerCase()).filter(Boolean));
      const unit = units.size === 1 ? gr.find((r) => r.unit)?.unit ?? "" : units.size === 0 ? "" : "gemischt";
      const totalQty = gr.reduce((s, r) => s + (r.quantity || 0), 0);
      const totalAmount = gr.reduce((s, r) => s + (r.lineTotal || 0), 0);
      const freq = new Map<string, number>();
      for (const r of gr) freq.set(r.article, (freq.get(r.article) ?? 0) + 1);
      const label = targetLabelByKey[key] ?? [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
      const supFreq = new Map<string, number>();
      for (const r of gr) if (r.supplier && r.supplier !== "—") supFreq.set(r.supplier, (supFreq.get(r.supplier) ?? 0) + 1);
      const supplierList = [...supFreq.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
      out.push({ key, label, rows: gr, totalQty, unit, totalAmount, suppliers: supplierList.length, supplierList, merged: !!targetLabelByKey[key] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, merges]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (g: Group): string | number => {
      switch (sortKey) {
        case "article": return g.label.toLowerCase();
        case "supplier": return (g.supplierList[0] ?? "").toLowerCase();
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
  const labelOf = useMemo(() => new Map(groups.map((g) => [g.key, g.label])), [groups]);

  const sortBy = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "article" || k === "supplier" ? "asc" : "desc");
    }
  };
  const toggleExpand = (k: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  const toggleSelect = (k: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const openMerge = () => {
    setCanonical([...selected][0] ?? "");
    setMergeOpen(true);
  };
  const doMerge = () => {
    const sel = [...selected];
    if (sel.length < 2 || !canonical) return;
    const sources = sel.filter((k) => k !== canonical);
    const label = labelOf.get(canonical) ?? "";
    startTransition(async () => {
      const res = await mergeArticlesAction(sources, canonical, label);
      if (res.ok) {
        setSelected(new Set());
        setMergeOpen(false);
        router.refresh();
      }
    });
  };
  const doUnmerge = (key: string) => {
    startTransition(async () => {
      const res = await unmergeArticlesAction(key);
      if (res.ok) router.refresh();
    });
  };

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

      {/* Auswahl-/Zusammenführen-Leiste */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-brand-red/30 bg-brand-red/5 px-4 py-2">
          <span className="text-sm font-medium text-gray-700">{selected.size} ausgewählt</span>
          {!mergeOpen ? (
            <>
              <button type="button" disabled={selected.size < 2 || pending} onClick={openMerge} className="rounded-md bg-brand-red px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">
                Zusammenführen
              </button>
              <button type="button" onClick={() => setSelected(new Set())} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                Auswahl aufheben
              </button>
              {selected.size < 2 && <span className="text-xs text-gray-500">Mind. 2 Artikel wählen</span>}
            </>
          ) : (
            <>
              <span className="text-sm text-gray-600">Beibehalten als:</span>
              <select value={canonical} onChange={(e) => setCanonical(e.target.value)} className="max-w-xs rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-900">
                {[...selected].map((k) => (
                  <option key={k} value={k}>
                    {labelOf.get(k) ?? k}
                  </option>
                ))}
              </select>
              <button type="button" disabled={pending} onClick={doMerge} className="rounded-md bg-brand-red px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">
                {pending ? "…" : "Übernehmen"}
              </button>
              <button type="button" onClick={() => setMergeOpen(false)} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                Abbrechen
              </button>
            </>
          )}
        </div>
      )}

      <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-500">
            Noch keine ausgelesenen Beleg-Artikel. Belege zuerst unter „Belege" indexieren.
          </p>
        ) : (
          <div className="max-h-[calc(100vh-16rem)] overflow-auto">
            <table className="w-full min-w-[860px] text-left text-xs">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-gray-700 [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:border-b-2 [&>th]:border-white/10 [&>th]:bg-[#191c20]">
                  <th className="w-8 px-2 py-2" />
                  <Th k="article" label="Artikel" />
                  <Th k="supplier" label="Lieferant" />
                  <Th k="qty" label="Gesamtmenge" cls="text-right" />
                  <Th k="amount" label="Gesamtbetrag" cls="text-right" />
                  <Th k="count" label="Belege" cls="text-center" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((g) => {
                  const open = expanded.has(g.key);
                  const isSel = selected.has(g.key);
                  return (
                    <Fragment key={g.key}>
                      <tr onClick={() => toggleExpand(g.key)} className={`cursor-pointer border-b border-gray-200 hover:bg-gray-100 ${isSel ? "bg-brand-red/5" : ""}`}>
                        <td className="px-2 py-2 align-top" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={isSel} onChange={() => toggleSelect(g.key)} title="Für Zusammenführen auswählen" />
                        </td>
                        <td className="px-3 py-2 align-top font-medium text-gray-800">
                          <span className="mr-1 text-gray-400">{open ? "▾" : "▸"}</span>
                          {g.label}
                          {g.merged && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                doUnmerge(g.key);
                              }}
                              title="Zusammenführung auflösen"
                              className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 hover:bg-indigo-200"
                            >
                              zusammengeführt ✕
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top text-gray-700" title={g.supplierList.join(", ")}>
                          {g.supplierList.length === 0 ? "—" : g.supplierList.length === 1 ? g.supplierList[0] : `${g.supplierList[0]} +${g.supplierList.length - 1}`}
                        </td>
                        <td className="px-3 py-2 text-right align-top whitespace-nowrap text-gray-800">
                          {num.format(g.totalQty)} {g.unit || ""}
                        </td>
                        <td className="px-3 py-2 text-right align-top whitespace-nowrap font-semibold text-gray-900">{eur.format(g.totalAmount)}</td>
                        <td className="px-3 py-2 text-center align-top whitespace-nowrap text-gray-600">{g.rows.length} · {g.suppliers} Lief.</td>
                      </tr>
                      {open && (
                        <tr className="border-b border-gray-200 bg-black/30">
                          <td colSpan={6} className="px-3 py-2">
                            <table className="w-full text-[11px]">
                              <thead>
                                <tr className="text-gray-300">
                                  <th className="px-2 py-1 text-left font-semibold">Bezeichnung</th>
                                  <th className="px-2 py-1 text-left font-semibold">Datum</th>
                                  <th className="px-2 py-1 text-left font-semibold">Lieferant</th>
                                  <th className="px-2 py-1 text-right font-semibold">Menge</th>
                                  <th className="px-2 py-1 text-right font-semibold">Einzelpreis</th>
                                  <th className="px-2 py-1 text-right font-semibold">Betrag</th>
                                  <th className="px-2 py-1 text-left font-semibold">Beleg</th>
                                </tr>
                              </thead>
                              <tbody>
                                {g.rows
                                  .slice()
                                  .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
                                  .map((r, i) => (
                                    <tr key={`${g.key}-${i}`} className="border-t border-white/10">
                                      <td className="px-2 py-1 text-gray-100">{r.article}</td>
                                      <td className="px-2 py-1 whitespace-nowrap text-gray-300">{r.date ? dateFmt.format(new Date(r.date)) : "—"}</td>
                                      <td className="px-2 py-1 text-gray-200">{r.supplier}</td>
                                      <td className="px-2 py-1 text-right whitespace-nowrap text-gray-200">{num.format(r.quantity)} {r.unit || ""}</td>
                                      <td className="px-2 py-1 text-right whitespace-nowrap text-gray-200">{r.unitPrice > 0 ? eur.format(r.unitPrice) : "—"}</td>
                                      <td className="px-2 py-1 text-right whitespace-nowrap font-semibold text-white">{eur.format(r.lineTotal)}</td>
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
        Artikel mit leicht abweichender Bezeichnung: mehrere Zeilen ankreuzen → „Zusammenführen" →
        eine Bezeichnung als Haupt wählen. Sie werden dann überall als ein Artikel gezählt (per
        „zusammengeführt ✕" wieder auflösbar).
      </p>
    </div>
  );
}
