"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import LogbookButton from "@/components/LogbookButton";
import type { PipelineProjectRef } from "@/lib/hero-api";

const currencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

const dateFormatter = new Intl.DateTimeFormat("de-DE");

export default function PipelineNode({
  label,
  projects,
  style,
  showOffer = false,
}: {
  label: string;
  projects: PipelineProjectRef[];
  style: React.CSSProperties;
  showOffer?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const offerTotal = projects.reduce((s, p) => s + p.offerSum, 0);
  const pathname = usePathname();

  // Auswahl für den E-Mail-Export der offenen Angebote (nur in Angebots-Stufen).
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const selectedProjects = projects.filter((p) => sel.has(p.id));
  const allSelected = projects.length > 0 && selectedProjects.length === projects.length;
  const toggle = (id: number) =>
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSel((prev) => (prev.size === projects.length ? new Set() : new Set(projects.map((p) => p.id))));

  // Auswahl beim Schließen zurücksetzen.
  useEffect(() => {
    if (!open) {
      setSel(new Set());
      setCopied(false);
    }
  }, [open]);

  /** Gruppiert die ausgewählten Angebote nach Kunde und baut den E-Mail-Text. */
  const buildList = (): string => {
    const byCust = new Map<string, PipelineProjectRef[]>();
    for (const p of selectedProjects) {
      const c = p.customerName || "Ohne Kunde";
      const arr = byCust.get(c) ?? [];
      arr.push(p);
      byCust.set(c, arr);
    }
    const custs = [...byCust.keys()].sort((a, b) => a.localeCompare(b, "de"));
    const lines: string[] = ["Offene Angebote – nachfassen", ""];
    let total = 0;
    for (const c of custs) {
      lines.push(`${c}:`);
      for (const p of byCust.get(c)!) {
        total += p.offerSum;
        const nr = p.relativeId != null ? `#${p.relativeId} ` : "";
        const sum = p.offerSum ? currencyFormatter.format(p.offerSum) : "—";
        const dat = p.offerDate ? `versendet ${dateFormatter.format(new Date(p.offerDate))}` : "nicht versendet";
        lines.push(`  - ${nr}${p.name} · ${sum} · ${dat}`);
      }
      lines.push("");
    }
    lines.push(`Summe (${selectedProjects.length} Angebote): ${currencyFormatter.format(total)}`);
    return lines.join("\n");
  };

  const onEmail = () => {
    if (selectedProjects.length === 0) return;
    const body = buildList();
    window.location.href = `mailto:?subject=${encodeURIComponent("Offene Angebote nachfassen")}&body=${encodeURIComponent(body)}`;
  };
  const onCopy = async () => {
    if (selectedProjects.length === 0) return;
    try {
      await navigator.clipboard.writeText(buildList());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* Clipboard evtl. nicht verfügbar */
    }
  };

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const modal = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-gray-800 px-5 py-3">
          <p className="text-sm font-medium text-gray-100">
            {label} <span className="text-gray-500">· {projects.length}</span>
            {showOffer && (
              <span className="ml-2 text-gray-400">
                · Angebotssumme {currencyFormatter.format(offerTotal)}
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-gray-500 hover:text-gray-100"
          >
            Schließen
          </button>
        </div>
        {showOffer && projects.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-800 bg-gray-900/60 px-5 py-2">
            <label className="flex items-center gap-1.5 text-xs text-gray-300">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              Alle
            </label>
            <span className="text-xs text-gray-500">{selectedProjects.length} ausgewählt</span>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={onCopy}
                disabled={selectedProjects.length === 0}
                className="rounded-md border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-gray-500 hover:text-gray-100 disabled:opacity-40"
              >
                {copied ? "Kopiert ✓" : "Liste kopieren"}
              </button>
              <button
                type="button"
                onClick={onEmail}
                disabled={selectedProjects.length === 0}
                className="rounded-md bg-brand-red px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                📧 Als E-Mail
              </button>
            </div>
          </div>
        )}
        <div className="overflow-y-auto">
          {projects.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-500">Keine Projekte.</p>
          ) : (
            <ul className="divide-y divide-gray-800/60">
              {projects.map((p) => (
                <li key={p.id} className="flex items-center transition-colors hover:bg-gray-800/40">
                  {showOffer && (
                    <label className="flex shrink-0 items-center self-stretch pl-4 pr-1">
                      <input
                        type="checkbox"
                        checked={sel.has(p.id)}
                        onChange={() => toggle(p.id)}
                        aria-label="Angebot für E-Mail-Liste auswählen"
                      />
                    </label>
                  )}
                  {/* Projektnummer → Projekt-Popup öffnen */}
                  <Link
                    href={`/dashboard/projekte?open=${p.id}&back=${encodeURIComponent(pathname ?? "/dashboard/cockpit")}`}
                    title="Projekt-Details öffnen"
                    className={`flex w-16 shrink-0 items-center self-stretch py-3 text-xs font-medium text-gray-500 transition-colors hover:text-brand-red ${showOffer ? "pl-2" : "pl-5"}`}
                  >
                    {p.relativeId ?? "—"}
                  </Link>
                  <Link
                    href={`/dashboard/projekte/${p.id}?name=${encodeURIComponent(p.name)}${
                      p.relativeId != null ? `&nr=${p.relativeId}` : ""
                    }`}
                    className="flex min-w-0 flex-1 items-baseline gap-3 py-3 pr-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-brand-red">{p.name}</span>
                      {p.customerName && (
                        <span className="block truncate text-xs text-gray-500">
                          {p.customerName}
                        </span>
                      )}
                    </span>
                    {showOffer && (
                      <span className="shrink-0 whitespace-nowrap text-right">
                        <span className="block text-sm text-gray-300">
                          {p.offerSum !== 0 ? currencyFormatter.format(p.offerSum) : "—"}
                        </span>
                        <span className="block text-xs text-gray-500">
                          {p.offerDate
                            ? `versendet ${dateFormatter.format(new Date(p.offerDate))}`
                            : "nicht versendet"}
                        </span>
                      </span>
                    )}
                  </Link>
                  {showOffer && (
                    <div className="shrink-0 pr-4 pl-2">
                      <LogbookButton projectId={p.id} projectName={p.name} projectRelativeId={p.relativeId} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={style}
        className="flex h-24 min-w-0 flex-1 flex-col justify-between rounded-xl p-2.5 text-left text-white shadow-lg shadow-black/30 transition-transform hover:scale-[1.03] focus:outline-none focus:ring-2 focus:ring-white/40"
      >
        <span className="text-xs font-medium leading-tight break-words text-white/90">{label}</span>
        <span className="text-2xl font-semibold">{projects.length}</span>
      </button>

      {open && mounted && createPortal(modal, document.body)}
    </>
  );
}
