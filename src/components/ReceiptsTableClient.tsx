"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import DocumentPreview from "@/components/DocumentPreview";
import type { InvoiceStatusTone } from "@/lib/invoices";

export interface ProjectRef {
  id: number;
  name: string;
  relativeId: number | null;
}

export interface FileRef {
  filename: string;
  docUrl: string;
  thumb256: string | null;
  thumb512: string | null;
  mime: string | null;
}

export interface ReceiptRow {
  id: string;
  number: string;
  dateStr: string;
  dueStr: string;
  party: string;
  projects: ProjectRef[];
  net: number;
  tax: number;
  gross: number;
  statusLabel: string;
  statusTone: InvoiceStatusTone;
  file: FileRef | null;
}

const currencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

const STATUS_STYLES: Record<InvoiceStatusTone, string> = {
  paid: "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/30",
  open: "bg-gray-400/20 text-gray-700 ring-1 ring-gray-400/40",
  overdue: "bg-brand-red/15 text-brand-red ring-1 ring-brand-red/30",
};

type FilterKey =
  | "number"
  | "date"
  | "due"
  | "party"
  | "project"
  | "net"
  | "tax"
  | "gross"
  | "status"
  | "document";

const EMPTY_FILTERS: Record<FilterKey, string> = {
  number: "",
  date: "",
  due: "",
  party: "",
  project: "",
  net: "",
  tax: "",
  gross: "",
  status: "",
  document: "",
};

function projectText(row: ReceiptRow): string {
  return row.projects.map((p) => `${p.relativeId ?? ""} ${p.name}`).join(" ");
}

const inputClass =
  "w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs font-normal text-gray-900 placeholder-gray-400 focus:border-brand-red focus:outline-none";

export default function ReceiptsTableClient({
  rows,
  partyLabel = "Kunde",
  showProject = true,
  showDue = true,
}: {
  rows: ReceiptRow[];
  partyLabel?: string;
  showProject?: boolean;
  showDue?: boolean;
}) {
  const [filters, setFilters] = useState<Record<FilterKey, string>>(EMPTY_FILTERS);

  const setFilter = (key: FilterKey, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const filtered = useMemo(() => {
    const f = {
      number: filters.number.trim().toLowerCase(),
      date: filters.date.trim().toLowerCase(),
      due: filters.due.trim().toLowerCase(),
      party: filters.party.trim().toLowerCase(),
      project: filters.project.trim().toLowerCase(),
      net: filters.net.trim().toLowerCase(),
      tax: filters.tax.trim().toLowerCase(),
      gross: filters.gross.trim().toLowerCase(),
      status: filters.status.trim().toLowerCase(),
      document: filters.document.trim().toLowerCase(),
    };
    return rows.filter((r) => {
      if (f.number && !r.number.toLowerCase().includes(f.number)) return false;
      if (f.date && !r.dateStr.toLowerCase().includes(f.date)) return false;
      if (showDue && f.due && !r.dueStr.toLowerCase().includes(f.due)) return false;
      if (f.party && !r.party.toLowerCase().includes(f.party)) return false;
      if (showProject && f.project && !projectText(r).toLowerCase().includes(f.project)) return false;
      if (f.net && !currencyFormatter.format(r.net).toLowerCase().includes(f.net)) return false;
      if (f.tax && !currencyFormatter.format(r.tax).toLowerCase().includes(f.tax)) return false;
      if (f.gross && !currencyFormatter.format(r.gross).toLowerCase().includes(f.gross)) return false;
      if (f.status && !r.statusLabel.toLowerCase().includes(f.status)) return false;
      if (f.document && !(r.file?.filename ?? "").toLowerCase().includes(f.document)) return false;
      return true;
    });
  }, [rows, filters, showProject, showDue]);

  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, r) => {
          acc.net += r.net;
          acc.tax += r.tax;
          acc.gross += r.gross;
          return acc;
        },
        { net: 0, tax: 0, gross: 0 }
      ),
    [filtered]
  );

  const leadingCols = 3 + (showDue ? 1 : 0) + (showProject ? 1 : 0);

  // Fixed column widths so every view fills the container at the same width,
  // regardless of how long the project/party text is (no horizontal overflow).
  const colWidths: string[] = [
    "9%", // Nr
    "8%", // Datum
    ...(showDue ? ["8%"] : []), // Fällig
    showProject ? "13%" : "18%", // party
    ...(showProject ? ["17%"] : []), // Projekt
    "9%", // Netto
    "8%", // Steuer
    "9%", // Brutto
    "10%", // Status
    "8%", // Dokument
  ];

  return (
    <table className="w-full table-fixed text-left text-sm">
      <colgroup>
        {colWidths.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
      <thead>
        <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
          <th className="px-3 py-3 font-medium">Nr.</th>
          <th className="px-3 py-3 font-medium">Datum</th>
          {showDue && <th className="px-3 py-3 font-medium">Fällig</th>}
          <th className="px-3 py-3 font-medium">{partyLabel}</th>
          {showProject && <th className="px-3 py-3 font-medium">Projekt</th>}
          <th className="px-3 py-3 font-medium text-right">Netto</th>
          <th className="px-3 py-3 font-medium text-right">Steuer</th>
          <th className="px-3 py-3 font-medium text-right">Brutto</th>
          <th className="px-3 py-3 font-medium">Status</th>
          <th className="px-3 py-3 font-medium">Dokument</th>
        </tr>
        <tr className="border-b border-gray-200">
          <th className="px-3 pb-3">
            <input
              className={inputClass}
              placeholder="Filter…"
              value={filters.number}
              onChange={(e) => setFilter("number", e.target.value)}
            />
          </th>
          <th className="px-3 pb-3">
            <input
              className={inputClass}
              placeholder="Filter…"
              value={filters.date}
              onChange={(e) => setFilter("date", e.target.value)}
            />
          </th>
          {showDue && (
            <th className="px-3 pb-3">
              <input
                className={inputClass}
                placeholder="Filter…"
                value={filters.due}
                onChange={(e) => setFilter("due", e.target.value)}
              />
            </th>
          )}
          <th className="px-3 pb-3">
            <input
              className={inputClass}
              placeholder="Filter…"
              value={filters.party}
              onChange={(e) => setFilter("party", e.target.value)}
            />
          </th>
          {showProject && (
            <th className="px-3 pb-3">
              <input
                className={inputClass}
                placeholder="Filter…"
                value={filters.project}
                onChange={(e) => setFilter("project", e.target.value)}
              />
            </th>
          )}
          <th className="px-3 pb-3">
            <input
              className={`${inputClass} text-right`}
              placeholder="Filter…"
              value={filters.net}
              onChange={(e) => setFilter("net", e.target.value)}
            />
          </th>
          <th className="px-3 pb-3">
            <input
              className={`${inputClass} text-right`}
              placeholder="Filter…"
              value={filters.tax}
              onChange={(e) => setFilter("tax", e.target.value)}
            />
          </th>
          <th className="px-3 pb-3">
            <input
              className={`${inputClass} text-right`}
              placeholder="Filter…"
              value={filters.gross}
              onChange={(e) => setFilter("gross", e.target.value)}
            />
          </th>
          <th className="px-3 pb-3">
            <input
              className={inputClass}
              placeholder="Filter…"
              value={filters.status}
              onChange={(e) => setFilter("status", e.target.value)}
            />
          </th>
          <th className="px-3 pb-3">
            <input
              className={inputClass}
              placeholder="Filter…"
              value={filters.document}
              onChange={(e) => setFilter("document", e.target.value)}
            />
          </th>
        </tr>
      </thead>
      <tbody>
        {filtered.length === 0 ? (
          <tr>
            <td
              colSpan={leadingCols + 5}
              className="px-3 py-8 text-center text-sm text-gray-500"
            >
              Keine Treffer für den Filter.
            </td>
          </tr>
        ) : (
          filtered.map((row) => (
            <tr
              key={row.id}
              className="border-b border-gray-200 last:border-0 hover:bg-gray-100"
            >
              <td className="px-3 py-2.5 font-medium break-words text-gray-800">{row.number}</td>
              <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{row.dateStr}</td>
              {showDue && (
                <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{row.dueStr}</td>
              )}
              <td className="px-3 py-2.5 break-words text-gray-700">{row.party}</td>
              {showProject && (
                <td className="px-3 py-2.5">
                  {row.projects.length === 0 ? (
                    <span className="text-gray-600">—</span>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {row.projects.map((p) => (
                        <Link
                          key={p.id}
                          href={`/dashboard/projekte/${p.id}?name=${encodeURIComponent(p.name)}${
                            p.relativeId != null ? `&nr=${p.relativeId}` : ""
                          }`}
                          className="group/proj flex flex-col leading-tight break-words"
                        >
                          {p.relativeId != null && (
                            <span className="text-xs font-medium text-gray-500">
                              Nr. {p.relativeId}
                            </span>
                          )}
                          <span className="text-brand-red transition-colors group-hover/proj:text-brand-red-dark group-hover/proj:underline">
                            {p.name}
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </td>
              )}
              <td className="px-3 py-2.5 whitespace-nowrap text-right text-gray-800">
                {currencyFormatter.format(row.net)}
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap text-right text-gray-600">
                {currencyFormatter.format(row.tax)}
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap text-right text-gray-800">
                {currencyFormatter.format(row.gross)}
              </td>
              <td className="px-3 py-2.5">
                <span
                  className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[row.statusTone]}`}
                >
                  {row.statusLabel}
                </span>
              </td>
              <td className="px-3 py-2.5">
                {row.file ? (
                  <DocumentPreview
                    filename={row.file.filename}
                    docUrl={row.file.docUrl}
                    thumbnailUrl={row.file.thumb256}
                    previewUrl={row.file.thumb512}
                    mimeType={row.file.mime}
                  />
                ) : (
                  <span className="text-gray-600">—</span>
                )}
              </td>
            </tr>
          ))
        )}
      </tbody>
      <tfoot>
        <tr className="border-t border-gray-300 text-sm font-semibold text-gray-900">
          <td className="px-3 py-3" colSpan={leadingCols}>
            Summe ({filtered.length})
          </td>
          <td className="px-3 py-3 whitespace-nowrap text-right">
            {currencyFormatter.format(totals.net)}
          </td>
          <td className="px-3 py-3 whitespace-nowrap text-right text-gray-700">
            {currencyFormatter.format(totals.tax)}
          </td>
          <td className="px-3 py-3 whitespace-nowrap text-right">
            {currencyFormatter.format(totals.gross)}
          </td>
          <td className="px-3 py-3" colSpan={2} />
        </tr>
      </tfoot>
    </table>
  );
}
