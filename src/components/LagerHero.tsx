"use client";

import { useMemo, useState } from "react";
import type { StockMovement } from "@/lib/material-types";
import BookingScanModal from "@/components/BookingScanModal";

export interface LagerItem {
  id: number; // HERO article (stock material) id
  name: string;
  itemNumber: string;
  qrId: string | null;
  unit: string;
  category: string | null;
  quantity: number; // local stock (MySQL)
}

interface ProjectOption {
  id: number;
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

export default function LagerHero({
  items,
  movements,
  projects,
}: {
  items: LagerItem[];
  movements: StockMovement[];
  projects: ProjectOption[];
}) {
  const [query, setQuery] = useState("");
  const [bookingOpen, setBookingOpen] = useState(false);

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
    <div className="flex flex-col gap-6">
      <div>
        <button
          type="button"
          onClick={() => setBookingOpen(true)}
          className="rounded-md bg-brand-red px-5 py-2.5 text-sm font-semibold text-white shadow transition-opacity hover:opacity-90"
        >
          + Neue Buchung (scannen)
        </button>
      </div>

      <BookingScanModal
        open={bookingOpen}
        onClose={() => setBookingOpen(false)}
        projects={projects}
        articles={items.map((a) => ({
          id: a.id,
          name: a.name,
          itemNumber: a.itemNumber,
          qrId: a.qrId,
          unit: a.unit,
        }))}
      />

      <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
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

        <div className="max-h-[34rem] overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-gray-50">
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2 font-semibold">Artikel-Nr.</th>
                <th className="px-4 py-2 font-semibold">Bezeichnung</th>
                <th className="px-4 py-2 font-semibold">Kategorie</th>
                <th className="px-4 py-2 text-right font-semibold">Bestand</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-sm text-gray-400">
                    Keine Artikel gefunden.
                  </td>
                </tr>
              ) : (
                filtered.map((a) => (
                  <tr key={a.id} className="border-t border-gray-100 align-top">
                    <td className="px-4 py-2 text-gray-500">{a.itemNumber || "—"}</td>
                    <td className="px-4 py-2 font-medium text-gray-900">{a.name}</td>
                    <td className="px-4 py-2 text-gray-500">{a.category ?? "—"}</td>
                    <td className="px-4 py-2 text-right">
                      <span
                        className={`font-semibold ${a.quantity < 0 ? "text-rose-600" : "text-gray-900"}`}
                      >
                        {numberFmt.format(a.quantity)} {a.unit}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bewegungs-Historie */}
      <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Letzte Buchungen</h2>
        {movements.length === 0 ? (
          <p className="text-sm text-gray-400">Noch keine Buchungen.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {movements.map((mv) => (
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
                <span
                  className={`shrink-0 font-semibold ${
                    mv.delta >= 0 ? "text-emerald-700" : "text-rose-600"
                  }`}
                >
                  {mv.delta >= 0 ? "+" : ""}
                  {numberFmt.format(mv.delta)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
