"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateOrderItemAction,
  removeOrderItemAction,
  clearDoneOrderAction,
  addManualOrderItemAction,
} from "@/app/dashboard/bestellliste/actions";
import type { OrderItem } from "@/lib/order-list";

const EMPTY_MANUAL = { articleLabel: "", supplier: "", quantity: "", unit: "", unitPrice: "", link: "" };

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const num = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

export default function OrderListClient({ items }: { items: OrderItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Lokale Mengen-Eingaben (damit das Tippen nicht bei jedem Render zurückspringt).
  const [qty, setQty] = useState<Record<number, string>>({});
  const [linkDraft, setLinkDraft] = useState<Record<number, string>>({});
  const [manual, setManual] = useState({ ...EMPTY_MANUAL });
  const [manualErr, setManualErr] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);

  const bySupplier = useMemo(() => {
    const m = new Map<string, OrderItem[]>();
    for (const it of items) {
      const s = it.supplier || "— ohne Lieferant —";
      (m.get(s) ?? m.set(s, []).get(s)!).push(it);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "de"));
  }, [items]);

  const openItems = items.filter((i) => !i.done).length;

  const patch = (id: number, p: { quantity?: number | null; done?: boolean; link?: string | null }) =>
    startTransition(async () => {
      await updateOrderItemAction(id, p);
      router.refresh();
    });
  const addManual = () =>
    startTransition(async () => {
      setManualErr(null);
      const res = await addManualOrderItemAction({
        articleLabel: manual.articleLabel,
        supplier: manual.supplier || null,
        quantity: manual.quantity === "" ? null : Number(manual.quantity),
        unit: manual.unit || null,
        unitPrice: manual.unitPrice === "" ? null : Number(manual.unitPrice),
        link: manual.link || null,
      });
      if (!res.ok) {
        setManualErr(res.error ?? "Hinzufügen fehlgeschlagen.");
        return;
      }
      setManual({ ...EMPTY_MANUAL });
      setShowManual(false);
      router.refresh();
    });
  const remove = (id: number) =>
    startTransition(async () => {
      await removeOrderItemAction(id);
      router.refresh();
    });
  const clearDone = () =>
    startTransition(async () => {
      await clearDoneOrderAction();
      router.refresh();
    });

  const printList = () => {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const body = bySupplier
      .map(([sup, list]) => {
        const rows = list
          .filter((i) => !i.done)
          .map(
            (i) =>
              `<tr><td>${esc(i.articleLabel)}${i.link ? `<br/><a href="${esc(i.link)}" style="font-size:9pt;color:#c01818">${esc(i.link)}</a>` : ""}</td><td style="text-align:right">${i.quantity != null ? num.format(i.quantity) : ""} ${esc(i.unit || "")}</td><td style="text-align:right">${i.unitPrice != null ? eur.format(i.unitPrice) : ""}</td></tr>`
          )
          .join("");
        if (!rows) return "";
        return `<h2>${esc(sup)}</h2><table><thead><tr><th>Artikel</th><th style="text-align:right">Menge</th><th style="text-align:right">Preis/Einh.</th></tr></thead><tbody>${rows}</tbody></table>`;
      })
      .join("");
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"/><title>Bestellliste</title>
      <style>@page{margin:1.6cm}body{font-family:Arial,sans-serif;color:#111;font-size:11pt}
      h1{font-size:16pt}h2{font-size:12pt;margin:1.1em 0 .3em;border-bottom:2px solid #c01818;padding-bottom:2px}
      table{width:100%;border-collapse:collapse;margin-bottom:.6em}
      th,td{border-bottom:1px solid #ccc;padding:4px 6px;text-align:left}</style></head>
      <body><h1>Bestellliste</h1><p>Stand: ${new Date().toLocaleString("de-DE")}</p>${body || "<p>Keine offenen Artikel.</p>"}</body></html>`;
    const w = window.open("", "_blank", "width=820,height=1040");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  };

  const manualForm = showManual ? (
    <div className="rounded-xl border border-brand-red/40 bg-white p-4 shadow-lg shadow-black/10">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Artikel manuell hinzufügen</h3>
        <button type="button" onClick={() => { setShowManual(false); setManualErr(null); }} className="text-xs text-gray-400 hover:text-brand-red">
          Abbrechen
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          value={manual.articleLabel}
          onChange={(e) => setManual((m) => ({ ...m, articleLabel: e.target.value }))}
          placeholder="Artikel *"
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-red/60 sm:col-span-2"
        />
        <input
          value={manual.supplier}
          onChange={(e) => setManual((m) => ({ ...m, supplier: e.target.value }))}
          placeholder="Lieferant"
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-red/60"
        />
        <input
          value={manual.link}
          onChange={(e) => setManual((m) => ({ ...m, link: e.target.value }))}
          placeholder="Link (https://…)"
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-red/60"
        />
        <input
          value={manual.quantity}
          onChange={(e) => setManual((m) => ({ ...m, quantity: e.target.value }))}
          placeholder="Menge"
          type="number"
          min={0}
          step="any"
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-red/60"
        />
        <input
          value={manual.unit}
          onChange={(e) => setManual((m) => ({ ...m, unit: e.target.value }))}
          placeholder="Einheit (Stk, m², Sack …)"
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-red/60"
        />
        <input
          value={manual.unitPrice}
          onChange={(e) => setManual((m) => ({ ...m, unitPrice: e.target.value }))}
          placeholder="Einzelpreis (€)"
          type="number"
          min={0}
          step="any"
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-red/60"
        />
      </div>
      {manualErr && <p className="mt-2 text-xs text-brand-red">{manualErr}</p>}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={addManual}
          disabled={pending || !manual.articleLabel.trim()}
          className="rounded-md bg-brand-red px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-red/90 disabled:opacity-50"
        >
          Hinzufügen
        </button>
      </div>
    </div>
  ) : null;

  const toolbar = (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm text-gray-600">{openItems} offen · {items.length} gesamt</span>
      <div className="ml-auto flex items-center gap-2">
        <button type="button" onClick={() => setShowManual((v) => !v)} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-brand-red/50">
          + Artikel
        </button>
        <button type="button" onClick={printList} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-brand-red/50">
          Drucken / PDF
        </button>
        <button type="button" onClick={clearDone} disabled={pending} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-brand-red/50 disabled:opacity-50">
          Erledigte entfernen
        </button>
      </div>
    </div>
  );

  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {toolbar}
        {manualForm}
        <div className="rounded-xl border border-gray-300 bg-white p-8 text-center text-sm text-gray-500 shadow-lg shadow-black/10">
          Die Bestellliste ist leer. Artikel im <strong>Preisvergleich</strong> auswählen und „Zur
          Bestellliste hinzufügen" – oder oben „+ Artikel" manuell erfassen.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {toolbar}
      {manualForm}

      {bySupplier.map(([sup, list]) => (
        <div key={sup} className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
          <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
            <h2 className="text-base font-semibold text-gray-900">🏷️ {sup}</h2>
            <span className="text-xs text-gray-500">{list.filter((i) => !i.done).length} offen</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {list.map((it) => (
              <li key={it.id} className={`flex flex-wrap items-center gap-3 px-5 py-2.5 ${it.done ? "opacity-50" : ""}`}>
                <input
                  type="checkbox"
                  checked={it.done}
                  onChange={(e) => patch(it.id, { done: e.target.checked })}
                  title="Als bestellt markieren"
                />
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm font-medium text-gray-900 ${it.done ? "line-through" : ""}`}>
                    {it.articleLabel}
                    {it.link && (
                      <a href={it.link} target="_blank" rel="noopener noreferrer" title={it.link} className="ml-1 text-brand-red hover:underline">
                        🔗
                      </a>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">
                    {it.unitPrice != null ? `${eur.format(it.unitPrice)}${it.unit ? " / " + it.unit : ""}` : ""}
                    {it.addedByName ? ` · von ${it.addedByName}` : ""}
                  </p>
                  <input
                    value={linkDraft[it.id] ?? (it.link ?? "")}
                    onChange={(e) => setLinkDraft((p) => ({ ...p, [it.id]: e.target.value }))}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v === (it.link ?? "")) return;
                      patch(it.id, { link: v === "" ? null : v });
                    }}
                    placeholder="Link (https://…)"
                    className="mt-1 w-full max-w-md rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-700 outline-none focus:border-brand-red/60"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={qty[it.id] ?? (it.quantity != null ? String(it.quantity) : "")}
                    onChange={(e) => setQty((p) => ({ ...p, [it.id]: e.target.value }))}
                    onBlur={(e) => patch(it.id, { quantity: e.target.value === "" ? null : Number(e.target.value) })}
                    placeholder="Menge"
                    className="w-20 rounded-md border border-gray-300 px-2 py-1 text-right text-sm text-gray-900 outline-none focus:border-brand-red/60"
                  />
                  <span className="w-10 text-xs text-gray-500">{it.unit || ""}</span>
                </div>
                <button type="button" onClick={() => remove(it.id)} className="text-xs text-gray-400 hover:text-brand-red" title="Entfernen">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
