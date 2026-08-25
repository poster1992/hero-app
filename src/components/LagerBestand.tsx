"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LagerItem } from "@/lib/material-types";
import { setMaterialEkAction, setMaterialMinMaxAction } from "@/app/dashboard/lager/actions";

const numberFmt = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

/** Inline EK editor: saves the price via server action. */
function EkCell({ item }: { item: LagerItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(item.ekPrice ? String(item.ekPrice).replace(".", ",") : "");

  const save = () => {
    const fd = new FormData();
    fd.set("heroArticleId", String(item.id));
    fd.set("price", value);
    startTransition(async () => {
      await setMaterialEkAction(fd);
      router.refresh();
    });
  };

  return (
    <div className="flex items-center justify-end gap-1">
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
        placeholder="0,00"
        className={`w-20 rounded-md border px-2 py-1 text-right text-sm outline-none focus:border-brand-red/60 ${
          item.ekPrice > 0 ? "border-gray-300" : "border-brand-red/50 bg-brand-red/5"
        }`}
      />
      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 transition-colors hover:border-brand-red/50 disabled:opacity-50"
      >
        ✓
      </button>
    </div>
  );
}

/** Inline-Editor für Lager-Minimum/-Maximum eines Artikels. */
function MinMaxCell({ item }: { item: LagerItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const fmtVal = (v: number | null) => (v == null ? "" : String(v).replace(".", ","));
  const [min, setMin] = useState(fmtVal(item.minStock));
  const [max, setMax] = useState(fmtVal(item.maxStock));

  const dirty = min !== fmtVal(item.minStock) || max !== fmtVal(item.maxStock);
  const save = () => {
    const fd = new FormData();
    fd.set("heroArticleId", String(item.id));
    fd.set("name", item.name);
    fd.set("unit", item.unit);
    fd.set("min", min);
    fd.set("max", max);
    startTransition(async () => {
      await setMaterialMinMaxAction(fd);
      router.refresh();
    });
  };
  const inputCls =
    "w-16 rounded-md border border-gray-300 px-2 py-1 text-right text-sm outline-none focus:border-brand-red/60";

  return (
    <div className="flex items-center justify-end gap-1">
      <input
        type="text"
        inputMode="decimal"
        value={min}
        onChange={(e) => setMin(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), save())}
        placeholder="Min"
        title="Lager-Minimum"
        className={inputCls}
      />
      <span className="text-gray-300">/</span>
      <input
        type="text"
        inputMode="decimal"
        value={max}
        onChange={(e) => setMax(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), save())}
        placeholder="Max"
        title="Lager-Maximum"
        className={inputCls}
      />
      <button
        type="button"
        onClick={save}
        disabled={pending || !dirty}
        className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 transition-colors hover:border-brand-red/50 disabled:opacity-40"
      >
        ✓
      </button>
    </div>
  );
}

/** Artikelbestandsliste (eigene Lager-Unterseite): Artikel & Bestand mit Suche, Min/Max, EK. */
export default function LagerBestand({
  items,
  canSeeEk = false,
  canEdit = false,
}: {
  items: LagerItem[];
  canSeeEk?: boolean;
  /** Darf Min/Max bearbeiten (Schreibrecht)? Sonst nur Anzeige. */
  canEdit?: boolean;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.itemNumber.toLowerCase().includes(q) ||
        (a.category?.toLowerCase().includes(q) ?? false)
    );
  }, [query, items]);

  return (
    <div className="border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <h2 className="text-lg font-semibold text-gray-900">
          Artikel &amp; Bestand{" "}
          <span className="text-sm font-normal text-gray-500">({filtered.length})</span>
        </h2>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Artikel suchen (Name, Nr., Kategorie) …"
          className="w-64 rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-brand-red/60"
        />
      </div>

      <div className="max-h-[calc(100vh-14rem)] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-gray-50">
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-2 font-semibold">Artikel-Nr.</th>
              <th className="px-4 py-2 font-semibold">Bezeichnung</th>
              <th className="px-4 py-2 font-semibold">Kategorie</th>
              <th className="px-4 py-2 text-right font-semibold">Bestand</th>
              <th className="px-4 py-2 text-right font-semibold">Min / Max</th>
              {canSeeEk && <th className="px-4 py-2 text-right font-semibold">EK-Preis</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={canSeeEk ? 6 : 5} className="px-4 py-4 text-sm text-gray-400">
                  Keine Artikel gefunden.
                </td>
              </tr>
            ) : (
              filtered.map((a) => {
                const under = a.minStock != null && a.quantity < a.minStock;
                const over = a.maxStock != null && a.quantity > a.maxStock;
                return (
                  <tr key={a.id} className="border-t border-gray-100 align-top">
                    <td className="px-4 py-2 text-gray-500">{a.itemNumber || "—"}</td>
                    <td className="px-4 py-2 font-medium text-gray-900">{a.name}</td>
                    <td className="px-4 py-2 text-gray-500">{a.category ?? "—"}</td>
                    <td className="px-4 py-2 text-right">
                      <span
                        className={`font-semibold ${
                          a.quantity < 0 || under ? "text-rose-600" : over ? "text-amber-600" : "text-gray-900"
                        }`}
                      >
                        {numberFmt.format(a.quantity)} {a.unit}
                      </span>
                      {under && (
                        <span className="ml-1.5 whitespace-nowrap rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                          ↓ unter Min
                        </span>
                      )}
                      {over && (
                        <span className="ml-1.5 whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          ↑ über Max
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {canEdit ? (
                        <MinMaxCell item={a} />
                      ) : (
                        <span className="text-gray-700 tabular-nums">
                          {a.minStock != null ? numberFmt.format(a.minStock) : "—"}
                          {" / "}
                          {a.maxStock != null ? numberFmt.format(a.maxStock) : "—"}
                        </span>
                      )}
                    </td>
                    {canSeeEk && (
                      <td className="px-4 py-2 text-right">
                        <EkCell item={a} />
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
