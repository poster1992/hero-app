"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import DocumentPreview from "@/components/DocumentPreview";
import type { InvoiceStatusTone } from "@/lib/invoices";
import { assignReviewAction, decideReviewAction } from "@/app/dashboard/belege/review-actions";
import { setReceiptPaymentStatusAction } from "@/app/dashboard/belege/status-actions";
import {
  buildMultilineSepaAction,
  saveSupplierIbanAction,
  type SepaItem,
  type SaveIbanState,
} from "@/app/dashboard/belege/sepa-actions";
import {
  analyzeReceiptsForExport,
  type OcrCheckInput,
  type OcrFinding,
} from "@/app/dashboard/belege/ocr-check-actions";

export interface ReviewHistoryItem {
  actionLabel: string;
  detail: string | null;
  byName: string | null;
  at: string | null;
}

export interface ReviewInfo {
  status: "offen" | "freigegeben" | "abgelehnt";
  statusLabel: string;
  assignedToName: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  note: string | null;
  history: ReviewHistoryItem[];
}

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
  /** Lokaler Zahlstatus-Override (überschreibt HERO); null = HERO-Status. */
  paidOverride?: "bezahlt" | "offen" | null;
  /** Wer/wann den lokalen Status gesetzt hat (für Tooltip). */
  paidOverrideInfo?: string | null;
  /** Freitext-Bemerkung zur Zahlung (z.B. aus der Kontoauszug-Zuordnung). */
  paidRemark?: string | null;
  file: FileRef | null;
  review?: ReviewInfo | null;
  /** Lieferanten-Kundennummer (für SEPA-IBAN-Mapping). */
  supplierId?: number | null;
  /** Offener Betrag (für SEPA-Zahlbetrag). */
  open?: number;
  /** Lieferant zieht per Bankeinzug ein. */
  directDebit?: boolean;
  /** OCR: Zahlungsziel laut Beleg. */
  zahlungszielOcr?: string | null;
  /** OCR: zu zahlender Skonto-Betrag. */
  skontoBetrag?: number | null;
  /** OCR: Ersparnis durch Skonto. */
  ersparnis?: number | null;
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
  reviewers = [],
  canReview = false,
  exportName = "hero-belege",
  enableSepa = false,
  enablePaidStatus = false,
  showOcr = false,
}: {
  rows: ReceiptRow[];
  partyLabel?: string;
  showProject?: boolean;
  showDue?: boolean;
  reviewers?: { id: number; name: string }[];
  canReview?: boolean;
  exportName?: string;
  enableSepa?: boolean;
  enablePaidStatus?: boolean;
  /** Zeigt die OCR-Spalten Zahlungsziel / Skonto-Betrag / Ersparnis. */
  showOcr?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeRow, setActiveRow] = useState<ReceiptRow | null>(null);
  const [historyRow, setHistoryRow] = useState<ReceiptRow | null>(null);
  const [filters, setFilters] = useState<Record<FilterKey, string>>(EMPTY_FILTERS);

  const runAction = (fd: FormData, fn: (fd: FormData) => Promise<void>) => {
    startTransition(async () => {
      await fn(fd);
      router.refresh();
      setActiveRow(null);
    });
  };

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

  // --- SEPA / Multiline-Export ---
  const sepaAmount = (r: ReceiptRow) => (r.open && r.open > 0 ? r.open : r.gross);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sepaBusy, setSepaBusy] = useState(false);
  const [sepaError, setSepaError] = useState<string | null>(null);
  const [sepaMissing, setSepaMissing] = useState<
    { customerId: number | null; name: string }[] | null
  >(null);
  // OCR-Prüfung vor dem Export
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrFindings, setOcrFindings] = useState<OcrFinding[] | null>(null);
  // Gewählte Anpassungen (Skonto-Beträge / übersprungene Belege), bleiben über
  // den IBAN-Nachpflege-Dialog hinweg erhalten.
  const [sepaOverrides, setSepaOverrides] = useState<Record<string, number>>({});
  const [sepaSkip, setSepaSkip] = useState<string[]>([]);

  const selectedFiltered = filtered.filter((r) => selected.has(r.id));
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (allFilteredSelected) filtered.forEach((r) => n.delete(r.id));
      else filtered.forEach((r) => n.add(r.id));
      return n;
    });

  const downloadXml = (xml: string, filename: string) => {
    const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Baut die SEPA-Datei mit ggf. angepassten Beträgen / übersprungenen Belegen.
  const runSepa = async (over?: Record<string, number>, skip?: string[]) => {
    const ov = over ?? sepaOverrides;
    const sk = skip ?? sepaSkip;
    const items: SepaItem[] = selectedFiltered
      .filter((r) => !sk.includes(r.id))
      .map((r) => ({
        customerId: r.supplierId ?? null,
        name: r.party,
        amount: ov[r.id] ?? sepaAmount(r),
        reference: r.number,
        heroId: r.id,
      }));
    if (items.length === 0) {
      setSepaError("Keine Belege für den Export übrig.");
      return;
    }
    setSepaBusy(true);
    setSepaError(null);
    try {
      const res = await buildMultilineSepaAction(items);
      if (res.error) {
        setSepaError(res.error);
        return;
      }
      if (res.missing.length > 0) {
        setSepaMissing(res.missing);
        return;
      }
      if (res.xml && res.filename) {
        downloadXml(res.xml, res.filename);
        setSepaMissing(null);
      }
    } finally {
      setSepaBusy(false);
    }
  };

  // Startet den Export: OCR-Prüfung der Belege, dann IMMER der Sichtkontroll-Dialog.
  const startSepa = async () => {
    setSepaError(null);
    setSepaOverrides({});
    setSepaSkip([]);
    setOcrBusy(true);
    try {
      const inputs: OcrCheckInput[] = selectedFiltered.map((r) => ({
        heroId: r.id,
        customerId: r.supplierId ?? null,
        name: r.party,
        amount: sepaAmount(r),
      }));
      const res = await analyzeReceiptsForExport(inputs);
      if (res.error) {
        // OCR-Ausfall blockiert die Zahlung nicht – Hinweis anzeigen, Kontrolle bleibt.
        setSepaError(`OCR-Hinweis: ${res.error}`);
      }
      // Immer ALLE ausgewählten Belege zeigen – auch ohne OCR-Treffer (Sichtkontrolle).
      const byId = new Map(res.findings.map((f) => [f.heroId, f]));
      const findings: OcrFinding[] = selectedFiltered.map((r) => {
        const found = byId.get(r.id);
        if (found) return found;
        return {
          heroId: r.id,
          name: r.party,
          plannedAmount: sepaAmount(r),
          ocrTotal: null,
          amountMismatch: false,
          skontoAvailable: false,
          skontoPercent: null,
          skontoDeadline: null,
          skontoAmount: null,
          skontoSource: null,
          unreadable: true,
          docUrl: r.file?.docUrl ?? null,
          message: res.error
            ? "OCR nicht verfügbar – Beleg bitte manuell prüfen."
            : "Nicht geprüft – Beleg bitte manuell prüfen.",
        };
      });
      setOcrFindings(findings);
    } finally {
      setOcrBusy(false);
    }
  };

  // Übernimmt die im Dialog berechneten Beträge / übersprungenen Belege und exportiert.
  const confirmOcr = (over: Record<string, number>, skip: string[]) => {
    setSepaOverrides(over);
    setSepaSkip(skip);
    setOcrFindings(null);
    void runSepa(over, skip);
  };

  const [zipping, setZipping] = useState<string | null>(null);
  const exportPdfs = async () => {
    const withFile = filtered.filter((r) => r.file);
    if (withFile.length === 0) return;
    setZipping(`0 / ${withFile.length}`);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const used = new Set<string>();
      let done = 0;
      for (const r of withFile) {
        try {
          const res = await fetch(r.file!.docUrl);
          if (res.ok) {
            const blob = await res.blob();
            const ext = (r.file!.filename.match(/\.[a-z0-9]+$/i)?.[0] ?? ".pdf").toLowerCase();
            const safeParty = r.party.replace(/[^\wäöüÄÖÜß .-]/g, "_").slice(0, 40);
            let name = `${r.number || "Beleg"}_${safeParty}${ext}`.replace(/\s+/g, " ").trim();
            let i = 2;
            while (used.has(name)) name = name.replace(ext, ` (${i++})${ext}`);
            used.add(name);
            zip.file(name, blob);
          }
        } catch {
          // einzelnes Dokument überspringen
        }
        done++;
        setZipping(`${done} / ${withFile.length}`);
      }
      const out = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${exportName}-pdf-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setZipping(null);
    }
  };

  const exportCsv = () => {
    const num = (n: number) => n.toFixed(2).replace(".", ",");
    const esc = (v: string) => {
      const s = String(v ?? "");
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      "Nr.",
      "Datum",
      ...(showDue ? ["Fällig"] : []),
      partyLabel,
      ...(showProject ? ["Projekt"] : []),
      "Netto",
      "Steuer",
      "Brutto",
      "Status",
      ...(canReview ? ["Prüfung"] : []),
    ];
    const lines = filtered.map((r) =>
      [
        r.number,
        r.dateStr,
        ...(showDue ? [r.dueStr] : []),
        r.party,
        ...(showProject ? [projectText(r).trim()] : []),
        num(r.net),
        num(r.tax),
        num(r.gross),
        r.statusLabel,
        ...(canReview ? [r.review?.statusLabel ?? "Offen"] : []),
      ]
        .map((c) => esc(String(c)))
        .join(";")
    );
    const csv = "﻿" + [header.join(";"), ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportName}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const leadingCols = (enableSepa ? 1 : 0) + 3 + (showDue ? 1 : 0) + (showProject ? 1 : 0);

  // Fixed column widths so every view fills the container at the same width,
  // regardless of how long the project/party text is (no horizontal overflow).
  const colWidths: string[] = [
    ...(enableSepa ? ["4%"] : []), // Auswahl
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
    ...(canReview ? ["11%"] : []), // Prüfung
    ...(showOcr ? ["9%", "9%", "9%"] : []), // Zahlungsziel / Skonto-Betrag / Ersparnis
  ];

  const table = (
    <table className={`w-full table-fixed text-left text-sm ${showOcr ? "min-w-[1120px]" : "min-w-[820px]"}`}>
      <colgroup>
        {colWidths.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
      <thead>
        <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
          {enableSepa && (
            <th className="px-3 py-3 text-center font-medium">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={toggleAll}
                title="Alle auswählen"
                aria-label="Alle auswählen"
              />
            </th>
          )}
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
          {canReview && <th className="px-3 py-3 font-medium">Prüfung</th>}
          {showOcr && (
            <>
              <th className="px-3 py-3 font-medium">Zahlungsziel</th>
              <th className="px-3 py-3 font-medium text-right">Skonto-Betrag</th>
              <th className="px-3 py-3 font-medium text-right">Ersparnis</th>
            </>
          )}
        </tr>
        <tr className="border-b border-gray-200">
          {enableSepa && <th className="px-3 pb-3" />}
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
          {canReview && <th className="px-3 pb-3" />}
          {showOcr && (
            <>
              <th className="px-3 pb-3" />
              <th className="px-3 pb-3" />
              <th className="px-3 pb-3" />
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {filtered.length === 0 ? (
          <tr>
            <td
              colSpan={leadingCols + 5 + (canReview ? 1 : 0) + (showOcr ? 3 : 0)}
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
              {enableSepa && (
                <td className="px-3 py-2.5 text-center">
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggleRow(row.id)}
                    aria-label="Beleg auswählen"
                  />
                </td>
              )}
              <td className="px-3 py-2.5 font-medium break-words text-gray-800">{row.number}</td>
              <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{row.dateStr}</td>
              {showDue && (
                <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{row.dueStr}</td>
              )}
              <td className="px-3 py-2.5 break-words text-gray-700">
                {row.party}
                {row.directDebit && (
                  <span className="ml-1.5 whitespace-nowrap rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-violet-500/30">
                    Bankeinzug
                  </span>
                )}
              </td>
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
                <div className="flex flex-col items-start gap-1">
                  <span
                    title={row.paidOverride ? `Lokal gesetzt${row.paidOverrideInfo ? `: ${row.paidOverrideInfo}` : ""}` : undefined}
                    className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[row.statusTone]}`}
                  >
                    {row.statusLabel}
                    {row.paidOverride ? " •" : ""}
                  </span>
                  {row.paidRemark && (
                    <span
                      title={row.paidRemark}
                      className="max-w-[160px] truncate text-[11px] italic text-gray-500"
                    >
                      💬 {row.paidRemark}
                    </span>
                  )}
                  {enablePaidStatus && (
                    <select
                      value={row.paidOverride ?? "hero"}
                      disabled={pending}
                      onChange={(e) => {
                        const fd = new FormData();
                        fd.set("heroId", row.id);
                        fd.set("status", e.target.value);
                        runAction(fd, setReceiptPaymentStatusAction);
                      }}
                      title="Zahlstatus lokal setzen (überschreibt HERO)"
                      className="rounded border border-gray-300 bg-white px-1 py-0.5 text-[11px] text-gray-700 outline-none focus:border-brand-red/60"
                    >
                      <option value="hero">HERO-Status</option>
                      <option value="bezahlt">Bezahlt</option>
                      <option value="offen">Offen</option>
                    </select>
                  )}
                </div>
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
              {canReview && (
                <td className="px-3 py-2.5">
                  <div className="flex flex-col items-start gap-1">
                    <ReviewBadge review={row.review ?? null} />
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setActiveRow(row)}
                        className="rounded-md border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
                      >
                        Prüfen
                      </button>
                      <button
                        type="button"
                        onClick={() => setHistoryRow(row)}
                        title="Historie anzeigen"
                        aria-label="Historie anzeigen"
                        className="rounded-md border border-gray-300 px-1.5 py-0.5 text-xs text-gray-600 transition-colors hover:border-brand-red/50 hover:text-gray-900"
                      >
                        🕘
                      </button>
                    </div>
                  </div>
                </td>
              )}
              {showOcr && (
                <>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-700">
                    {row.zahlungszielOcr || "—"}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-right text-gray-800">
                    {row.skontoBetrag != null ? currencyFormatter.format(row.skontoBetrag) : "—"}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-right text-emerald-600">
                    {row.ersparnis != null ? currencyFormatter.format(row.ersparnis) : "—"}
                  </td>
                </>
              )}
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
          <td className="px-3 py-3" colSpan={2 + (canReview ? 1 : 0) + (showOcr ? 3 : 0)} />
        </tr>
      </tfoot>
    </table>
  );

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        {enableSepa && sepaError && (
          <span className="mr-auto text-sm text-rose-600">{sepaError}</span>
        )}
        {enableSepa && (
          <button
            type="button"
            onClick={startSepa}
            disabled={ocrBusy || sepaBusy || selectedFiltered.length === 0}
            className="rounded-md bg-brand-red px-3 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {ocrBusy
              ? "Prüfe Belege (OCR) …"
              : sepaBusy
                ? "Erzeuge SEPA …"
                : `Multiline SEPA-Export (${selectedFiltered.length})`}
          </button>
        )}
        <button
          type="button"
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900 disabled:opacity-50"
        >
          ⬇ Export CSV ({filtered.length})
        </button>
        <button
          type="button"
          onClick={exportPdfs}
          disabled={zipping !== null || filtered.filter((r) => r.file).length === 0}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900 disabled:opacity-50"
        >
          {zipping ? `PDFs … ${zipping}` : `⬇ Export PDFs (${filtered.filter((r) => r.file).length})`}
        </button>
      </div>
      <div className="overflow-x-auto">{table}</div>
      {canReview && activeRow && (
        <ReviewModal
          row={activeRow}
          reviewers={reviewers}
          pending={pending}
          onClose={() => setActiveRow(null)}
          onAssign={(fd) => runAction(fd, assignReviewAction)}
          onDecide={(fd) => runAction(fd, decideReviewAction)}
        />
      )}
      {canReview && historyRow && (
        <HistoryModal row={historyRow} onClose={() => setHistoryRow(null)} />
      )}
      {ocrFindings && (
        <OcrReviewModal
          findings={ocrFindings}
          onClose={() => setOcrFindings(null)}
          onConfirm={confirmOcr}
        />
      )}
      {sepaMissing && (
        <MissingIbanModal
          missing={sepaMissing}
          onClose={() => setSepaMissing(null)}
          onContinue={() => {
            setSepaMissing(null);
            void runSepa();
          }}
        />
      )}
    </>
  );
}

/** Dialog: OCR-Ergebnisse prüfen und je Beleg Originalbetrag / Skonto / Überspringen wählen. */
type OcrDecision = "original" | "skonto" | "custom" | "skip";

function OcrReviewModal({
  findings,
  onClose,
  onConfirm,
}: {
  findings: OcrFinding[];
  onClose: () => void;
  onConfirm: (overrides: Record<string, number>, skip: string[]) => void;
}) {
  const attention = findings.filter(
    (f) => f.amountMismatch || f.error || f.unreadable
  ).length;
  const [decisions, setDecisions] = useState<Record<string, OcrDecision>>(() => {
    const init: Record<string, OcrDecision> = {};
    for (const f of findings) init[f.heroId] = "original";
    return init;
  });
  // Manuell eingegebene Beträge je Beleg (vorbelegt mit dem OCR-Betrag bei Abweichung).
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of findings) {
      if (f.amountMismatch && f.ocrTotal != null) init[f.heroId] = f.ocrTotal.toFixed(2);
    }
    return init;
  });
  const set = (id: string, v: OcrDecision) => setDecisions((p) => ({ ...p, [id]: v }));

  const parseAmount = (s: string): number | null => {
    const n = Number(s.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  };
  // Beleg mit "Anderer Betrag", aber ungültiger Eingabe → Export blockieren.
  const hasInvalidCustom = findings.some(
    (f) => decisions[f.heroId] === "custom" && parseAmount(customAmounts[f.heroId] ?? "") == null
  );

  const submit = () => {
    const over: Record<string, number> = {};
    const skip: string[] = [];
    for (const f of findings) {
      const d = decisions[f.heroId] ?? "original";
      if (d === "skip") skip.push(f.heroId);
      else if (d === "skonto" && f.skontoAmount != null) over[f.heroId] = f.skontoAmount;
      else if (d === "custom") {
        const amt = parseAmount(customAmounts[f.heroId] ?? "");
        if (amt != null) over[f.heroId] = amt;
      }
    }
    onConfirm(over, skip);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-gray-300 bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-gray-900">Beleg-Prüfung (OCR)</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 transition-colors hover:text-gray-700"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>
        <p className="mb-4 text-sm text-gray-600">
          Sichtkontrolle: Bitte alle {findings.length} ausgewählten Belege prüfen und je Beleg die
          Zahlung bestätigen.
          {attention > 0 && (
            <span className="text-amber-400">
              {" "}
              {attention} Beleg{attention === 1 ? "" : "e"} mit Hinweis – farblich markiert.
            </span>
          )}
        </p>

        <div className="max-h-[55vh] space-y-3 overflow-y-auto">
          {findings.map((f) => (
            <div
              key={f.heroId}
              className={`rounded-lg border p-3 ${
                f.error || f.unreadable
                  ? "border-amber-500/40 bg-amber-500/10"
                  : f.amountMismatch
                    ? "border-rose-500/40 bg-rose-500/10"
                    : f.skontoAvailable
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-gray-300 bg-gray-50"
              }`}
            >
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-gray-900">{f.name}</span>
                <span className="text-xs text-gray-600">
                  Zahlbetrag {currencyFormatter.format(f.plannedAmount)}
                </span>
              </div>
              <p className="mb-2 text-xs text-gray-700">
                {f.error ? `⚠ ${f.error}` : f.message}
              </p>
              {f.docUrl && (
                <a
                  href={f.docUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mb-2 inline-block text-xs font-medium text-brand-red hover:underline"
                >
                  Beleg öffnen ↗
                </a>
              )}
              <div className="flex flex-wrap gap-3 text-sm">
                <label className="flex items-center gap-1.5 text-gray-700">
                  <input
                    type="radio"
                    name={`d-${f.heroId}`}
                    checked={(decisions[f.heroId] ?? "original") === "original"}
                    onChange={() => set(f.heroId, "original")}
                  />
                  Originalbetrag ({currencyFormatter.format(f.plannedAmount)})
                </label>
                {f.skontoAvailable && f.skontoAmount != null && (
                  <label className="flex items-center gap-1.5 text-gray-700">
                    <input
                      type="radio"
                      name={`d-${f.heroId}`}
                      checked={decisions[f.heroId] === "skonto"}
                      onChange={() => set(f.heroId, "skonto")}
                    />
                    Skonto zahlen ({currencyFormatter.format(f.skontoAmount)})
                  </label>
                )}
                <label className="flex items-center gap-1.5 text-gray-700">
                  <input
                    type="radio"
                    name={`d-${f.heroId}`}
                    checked={decisions[f.heroId] === "custom"}
                    onChange={() => set(f.heroId, "custom")}
                  />
                  Anderer Betrag
                  <span className="flex items-center gap-1">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={customAmounts[f.heroId] ?? ""}
                      placeholder="0,00"
                      onFocus={() => set(f.heroId, "custom")}
                      onChange={(e) =>
                        setCustomAmounts((p) => ({ ...p, [f.heroId]: e.target.value }))
                      }
                      className={`w-24 rounded-md border px-2 py-0.5 text-right text-sm outline-none focus:border-brand-red/60 ${
                        decisions[f.heroId] === "custom" &&
                        parseAmount(customAmounts[f.heroId] ?? "") == null
                          ? "border-rose-500"
                          : "border-gray-300"
                      }`}
                    />
                    <span className="text-gray-500">€</span>
                  </span>
                </label>
                <label className="flex items-center gap-1.5 text-gray-700">
                  <input
                    type="radio"
                    name={`d-${f.heroId}`}
                    checked={decisions[f.heroId] === "skip"}
                    onChange={() => set(f.heroId, "skip")}
                  />
                  Überspringen
                </label>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={hasInvalidCustom}
            className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Export fortsetzen
          </button>
        </div>
      </div>
    </div>
  );
}

/** Dialog zum Nachpflegen fehlender Lieferanten-IBANs vor dem SEPA-Export. */
function MissingIbanModal({
  missing,
  onClose,
  onContinue,
}: {
  missing: { customerId: number | null; name: string }[];
  onClose: () => void;
  onContinue: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl border border-gray-300 bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-gray-900">Fehlende IBANs</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 transition-colors hover:text-gray-700"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>
        <p className="mb-4 text-sm text-gray-600">
          Für folgende Lieferanten ist keine IBAN hinterlegt. Bitte einmalig eintragen – danach „Export
          fortsetzen".
        </p>
        <div className="space-y-3">
          {missing.map((m) => (
            <SupplierIbanRow key={`${m.customerId}-${m.name}`} customerId={m.customerId} name={m.name} />
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Export fortsetzen
          </button>
        </div>
      </div>
    </div>
  );
}

function SupplierIbanRow({ customerId, name }: { customerId: number | null; name: string }) {
  const [state, action, pending] = useActionState<SaveIbanState, FormData>(saveSupplierIbanAction, {});
  if (customerId == null) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        {name}: keine Lieferanten-ID – nicht exportierbar.
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 border-b border-gray-100 pb-3">
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="name" value={name} />
      <span className="w-full text-sm font-medium text-gray-800 sm:w-40 sm:truncate">{name}</span>
      <input
        name="iban"
        required
        placeholder="IBAN"
        className="min-w-[12rem] flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 outline-none focus:border-brand-red/60"
      />
      <input
        name="bic"
        placeholder="BIC (optional)"
        className="w-32 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 outline-none focus:border-brand-red/60"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 disabled:opacity-50"
      >
        {pending ? "…" : "Speichern"}
      </button>
      {state.error && <span className="text-xs text-rose-600">{state.error}</span>}
      {state.success && <span className="text-xs text-emerald-700">✓</span>}
    </form>
  );
}

function HistoryModal({ row, onClose }: { row: ReceiptRow; onClose: () => void }) {
  const history = row.review?.history ?? [];
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-gray-300 bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-gray-900">
            Historie · {row.number || "Beleg"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 transition-colors hover:text-gray-700"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>
        {history.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-500">Noch keine Historie.</p>
        ) : (
          <ul className="space-y-1.5 border-l-2 border-gray-200 pl-3">
            {history.map((h, i) => (
              <li key={i} className="text-sm text-gray-600">
                <span className="text-gray-400">{formatHistoryDate(h.at)}</span>
                {h.byName ? ` · ${h.byName}` : ""} —{" "}
                <span className="font-medium">{h.actionLabel}</span>
                {h.detail ? `: ${h.detail}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ReviewBadge({ review }: { review: ReviewInfo | null }) {
  if (review?.status === "freigegeben") {
    return (
      <span className="whitespace-nowrap rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-500/30">
        Freigegeben
      </span>
    );
  }
  if (review?.status === "abgelehnt") {
    return (
      <span className="whitespace-nowrap rounded-full bg-brand-red/15 px-2 py-0.5 text-xs font-medium text-brand-red ring-1 ring-brand-red/30">
        Abgelehnt
      </span>
    );
  }
  if (review?.assignedToName) {
    return (
      <span className="whitespace-nowrap rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-500/30">
        {review.assignedToName}
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap rounded-full bg-gray-400/20 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-gray-400/40">
      Offen
    </span>
  );
}

function ReviewModal({
  row,
  reviewers,
  pending,
  onClose,
  onAssign,
  onDecide,
}: {
  row: ReceiptRow;
  reviewers: { id: number; name: string }[];
  pending: boolean;
  onClose: () => void;
  onAssign: (fd: FormData) => void;
  onDecide: (fd: FormData) => void;
}) {
  const baseFields = (fd: FormData) => {
    fd.set("heroId", row.id);
    fd.set("number", row.number);
    fd.set("supplier", row.party);
    fd.set("gross", String(row.gross));
    if (row.file?.docUrl) fd.set("docUrl", row.file.docUrl);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-gray-300 bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-gray-900">Rechnung prüfen</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 transition-colors hover:text-gray-700"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 space-y-1 text-sm">
          <p className="font-medium text-gray-900">
            {row.number} · {row.party}
          </p>
          <p className="text-gray-600">
            {row.dateStr} · {currencyFormatter.format(row.gross)} brutto
          </p>
          {row.file && (
            <a
              href={row.file.docUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-brand-red hover:underline"
            >
              Beleg ansehen
            </a>
          )}
          {row.review?.status === "freigegeben" && (
            <p className="text-emerald-700">
              Freigegeben{row.review.reviewedByName ? ` von ${row.review.reviewedByName}` : ""}
            </p>
          )}
          {row.review?.status === "abgelehnt" && (
            <p className="text-brand-red">
              Abgelehnt{row.review.reviewedByName ? ` von ${row.review.reviewedByName}` : ""}
            </p>
          )}
          {row.review?.note && <p className="text-gray-600">Notiz: {row.review.note}</p>}
        </div>

        {/* Prüfer zuweisen (legt eine Aufgabe an) */}
        <form
          action={(fd) => {
            baseFields(fd);
            onAssign(fd);
          }}
          className="mb-4 flex items-end gap-2 border-b border-gray-200 pb-4"
        >
          <div className="flex-1">
            <label className="mb-1 block text-xs text-gray-600">Prüfer zuweisen (Aufgabe)</label>
            <select
              name="toUserId"
              defaultValue=""
              required
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-red/60"
            >
              <option value="" disabled>
                Mitarbeiter wählen …
              </option>
              {reviewers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              name="note"
              placeholder="Notiz an den Prüfer (optional) …"
              className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-red/60"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 disabled:opacity-50"
          >
            Zuweisen
          </button>
        </form>

        {/* Entscheidung */}
        <form
          action={(fd) => {
            baseFields(fd);
            onDecide(fd);
          }}
          className="space-y-3"
        >
          <div>
            <label className="mb-1 block text-xs text-gray-600">Kommentar (optional)</label>
            <textarea
              name="note"
              rows={2}
              defaultValue={row.review?.note ?? ""}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60"
              placeholder="z. B. sachlich/rechnerisch geprüft …"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              name="decision"
              value="freigegeben"
              disabled={pending}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Freigeben
            </button>
            <button
              type="submit"
              name="decision"
              value="abgelehnt"
              disabled={pending}
              className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Ablehnen
            </button>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              Schließen
            </button>
          </div>
        </form>

        {row.review?.history && row.review.history.length > 0 && (
          <div className="mt-4 border-t border-gray-200 pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Historie
            </p>
            <ul className="space-y-1.5 border-l-2 border-gray-200 pl-3">
              {row.review.history.map((h, i) => (
                <li key={i} className="text-xs text-gray-600">
                  <span className="text-gray-400">{formatHistoryDate(h.at)}</span>
                  {h.byName ? ` · ${h.byName}` : ""} — <span className="font-medium">{h.actionLabel}</span>
                  {h.detail ? `: ${h.detail}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function formatHistoryDate(s: string | null): string {
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
