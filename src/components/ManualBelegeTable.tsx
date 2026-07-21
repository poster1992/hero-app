"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBelegPaidAction } from "@/app/dashboard/belege/manual-actions";
import BelegEditButton from "@/components/BelegEditButton";
import DeleteBelegButton from "@/components/DeleteBelegButton";
import type { ProjectOption, SupplierOption } from "@/components/ManualBelegeForm";
import type { ManualReceipt } from "@/lib/manual-receipts";

type AccountOption = { number: string; name: string };
export type BelegRow = ManualReceipt & { duplicate: boolean };

const currencyFormatter = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const dateFormatter = new Intl.DateTimeFormat("de-DE");

function formatDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? d : dateFormatter.format(dt);
}

/** Status-Zelle: Bezahlt/Offen + Skonto-Kennzeichnung; „als bezahlt" fragt bei Skonto nach. */
function PaidCell({ r }: { r: BelegRow }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [menu, setMenu] = useState(false);
  // Position des Auswahlmenüs (fixed, damit es nicht vom Tabellen-Container
  // abgeschnitten wird; öffnet nach oben, wenn unten kein Platz ist).
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  // Skonto anbietbar, wenn ein (echt niedrigerer) Skontozahlbetrag hinterlegt ist.
  const hasSkonto = r.skontoPayAmount != null && r.skontoPayAmount < r.gross;
  const saving = hasSkonto ? r.gross - (r.skontoPayAmount as number) : 0;

  const MENU_W = 224; // w-56
  const openMenu = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - MENU_W - 8));
      // Wenig Platz nach unten → nach oben öffnen.
      if (rect.bottom > window.innerHeight - 130) {
        setPos({ left, bottom: window.innerHeight - rect.top + 4 });
      } else {
        setPos({ left, top: rect.bottom + 4 });
      }
    }
    setMenu(true);
  };

  const setPaid = (paid: boolean, withSkonto: boolean) => {
    setMenu(false);
    const fd = new FormData();
    fd.set("id", String(r.id));
    fd.set("paid", paid ? "1" : "0");
    fd.set("withSkonto", withSkonto ? "1" : "0");
    start(async () => {
      await setBelegPaidAction(fd);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {r.isPaid ? (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Bezahlt</span>
      ) : (
        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">Offen</span>
      )}
      {r.isPaid &&
        (r.paidWithSkonto ? (
          <span
            className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700"
            title="Mit Skonto bezahlt – nur der reduzierte Betrag zählt als Ausgabe"
          >
            Skonto −{currencyFormatter.format(saving > 0 ? saving : (r.skontoAmount ?? 0))}
          </span>
        ) : hasSkonto ? (
          <span
            className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500"
            title="Voll bezahlt (kein Skonto gezogen)"
          >
            ohne Skonto
          </span>
        ) : null)}

      {r.isPaid ? (
        <button
          type="button"
          onClick={() => setPaid(false, false)}
          disabled={busy}
          className="rounded-md border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900 disabled:opacity-50"
        >
          auf offen
        </button>
      ) : hasSkonto ? (
        <div className="relative">
          <button
            ref={btnRef}
            type="button"
            onClick={() => (menu ? setMenu(false) : openMenu())}
            disabled={busy}
            className="rounded-md border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900 disabled:opacity-50"
          >
            als bezahlt ▾
          </button>
          {menu && pos && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
              <div
                className="fixed z-50 w-56 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-xl"
                style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}
              >
                <button
                  type="button"
                  onClick={() => setPaid(true, true)}
                  className="block w-full px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50"
                >
                  Mit Skonto · {currencyFormatter.format(r.skontoPayAmount as number)}
                  <span className="ml-1 text-emerald-600">(−{currencyFormatter.format(saving)})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaid(true, false)}
                  className="block w-full px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50"
                >
                  Voll · {currencyFormatter.format(r.gross)}
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPaid(true, false)}
          disabled={busy}
          className="rounded-md border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900 disabled:opacity-50"
        >
          als bezahlt
        </button>
      )}
    </div>
  );
}

/** Suchtext für Betragsspalten: formatiert + roh (mit Komma), damit "1234" und "1.234,56" treffen. */
function money(x: number | null): string {
  if (x == null) return "";
  return `${currencyFormatter.format(x)} ${String(x).replace(".", ",")}`;
}

/** Textspalten, die per Eingabefeld im Tabellenkopf gefiltert werden. */
const TEXT_COLS = [
  "id",
  "datum",
  "lieferant",
  "belegnr",
  "konto",
  "projekt",
  "netto",
  "mwst",
  "brutto",
  "skonto",
  "skontozahl",
  "skontobis",
] as const;
type TextCol = (typeof TEXT_COLS)[number];

const filterInputClass =
  "w-full min-w-0 rounded border border-gray-300 bg-white px-1.5 py-1 text-xs font-normal normal-case text-gray-700 outline-none focus:border-brand-red/60";

/** Tabelle der manuellen Belege mit Spalten-Filtern im Tabellenkopf.
 *  Die View-Reiter oben (Monatlich/Alle/Offen/Fällig, Suche) filtern bereits
 *  serverseitig vor; die Kopf-Filter verfeinern die Anzeige clientseitig. */
export default function ManualBelegeTable({
  rows,
  accounts,
  projects,
  suppliers,
  periodLabel,
}: {
  rows: BelegRow[];
  accounts: AccountOption[];
  projects: ProjectOption[];
  suppliers: SupplierOption[];
  periodLabel: string;
}) {
  const [text, setText] = useState<Record<TextCol, string>>({
    id: "",
    datum: "",
    lieferant: "",
    belegnr: "",
    konto: "",
    projekt: "",
    netto: "",
    mwst: "",
    brutto: "",
    skonto: "",
    skontozahl: "",
    skontobis: "",
  });
  const [status, setStatus] = useState<"" | "open" | "paid">("");
  const [beleg, setBeleg] = useState<"" | "with" | "without">("");

  const setCol = (col: TextCol, value: string) => setText((t) => ({ ...t, [col]: value }));

  // Filter-Suchwerte je Zeile (auf den angezeigten Spaltentext).
  const searchValues = useMemo(
    () =>
      new Map<number, Record<TextCol, string>>(
        rows.map((r) => [
          r.id,
          {
            id: `#${r.id} ${r.id}`,
            datum: formatDate(r.date),
            lieferant: r.supplier ?? "",
            belegnr: r.invoiceNumber ?? "",
            konto: r.accountNumber ? `${r.accountNumber} ${r.accountName ?? ""}` : "",
            projekt: r.projectId
              ? `${r.projectRelativeId != null ? `#${r.projectRelativeId} ` : ""}${r.projectName ?? "Projekt"}`
              : "",
            netto: money(r.net),
            mwst: money(r.vat),
            brutto: money(r.gross),
            skonto: money(r.skontoAmount),
            skontozahl: money(r.skontoPayAmount),
            skontobis: formatDate(r.skontoDueDate),
          },
        ])
      ),
    [rows]
  );

  const filtered = useMemo(() => {
    const active = TEXT_COLS.filter((c) => text[c].trim()).map((c) => [c, text[c].trim().toLowerCase()] as const);
    return rows.filter((r) => {
      if (status === "open" && r.isPaid) return false;
      if (status === "paid" && !r.isPaid) return false;
      if (beleg === "with" && !r.hasFile) return false;
      if (beleg === "without" && r.hasFile) return false;
      const v = searchValues.get(r.id);
      if (!v) return true;
      for (const [col, q] of active) {
        if (!v[col].toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, text, status, beleg, searchValues]);

  const total = filtered.reduce((s, r) => s + r.gross, 0);
  const anyFilter = status !== "" || beleg !== "" || TEXT_COLS.some((c) => text[c].trim() !== "");

  // --- Steuerberater-Export (alle angezeigten Belege) ---
  const withFileCount = filtered.filter((r) => r.hasFile).length;
  const [zipping, setZipping] = useState<string | null>(null);

  // Dateiendung aus Originalname bzw. MIME ableiten (Fallback .pdf).
  const fileExt = (r: BelegRow): string => {
    const fromName = r.fileName?.match(/\.[a-z0-9]+$/i)?.[0];
    if (fromName) return fromName.toLowerCase();
    if (r.mime?.includes("pdf")) return ".pdf";
    if (r.mime?.startsWith("image/")) return `.${r.mime.slice(6).split("+")[0]}`;
    return ".pdf";
  };

  const exportPdfs = async () => {
    const withFile = filtered.filter((r) => r.hasFile);
    if (withFile.length === 0) return;
    setZipping(`0 / ${withFile.length}`);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const used = new Set<string>();
      let done = 0;
      for (const r of withFile) {
        try {
          const res = await fetch(`/api/beleg?id=${r.id}`);
          if (res.ok) {
            const blob = await res.blob();
            const ext = fileExt(r);
            const label = (r.invoiceNumber || `Beleg-${r.id}`).toString();
            const safeParty = (r.supplier ?? "").replace(/[^\wäöüÄÖÜß .-]/g, "_").slice(0, 40);
            let name = `${label}_${safeParty}${ext}`.replace(/\s+/g, " ").trim();
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
      a.download = `Belege-${periodLabel.replace(/[^\wäöüÄÖÜß-]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setZipping(null);
    }
  };

  const exportCsv = () => {
    const money2 = (n: number) => n.toFixed(2).replace(".", ",");
    const esc = (v: string) => {
      const s = String(v ?? "");
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      "ID",
      "Datum",
      "Lieferant",
      "Beleg-Nr.",
      "Konto",
      "Projekt",
      "Netto",
      "MwSt",
      "Brutto",
      "Skonto",
      "Skontozahlbetrag",
      "Skonto bis",
      "Status",
      "Beleg vorhanden",
    ];
    const lines = filtered.map((r) =>
      [
        `#${r.id}`,
        formatDate(r.date),
        r.supplier ?? "",
        r.invoiceNumber ?? "",
        r.accountNumber ? `${r.accountNumber} ${r.accountName ?? ""}`.trim() : "",
        r.projectId ? `${r.projectRelativeId != null ? `#${r.projectRelativeId} ` : ""}${r.projectName ?? "Projekt"}` : "",
        money2(r.net),
        money2(r.vat),
        money2(r.gross),
        r.skontoAmount != null ? money2(r.skontoAmount) : "",
        r.skontoPayAmount != null ? money2(r.skontoPayAmount) : "",
        formatDate(r.skontoDueDate),
        r.isPaid ? "Bezahlt" : "Offen",
        r.hasFile ? "ja" : "nein",
      ]
        .map(esc)
        .join(";")
    );
    // BOM, damit Excel Umlaute korrekt liest.
    const csv = "﻿" + [header.join(";"), ...lines].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `Belege-${periodLabel.replace(/[^\wäöüÄÖÜß-]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setText({
      id: "",
      datum: "",
      lieferant: "",
      belegnr: "",
      konto: "",
      projekt: "",
      netto: "",
      mwst: "",
      brutto: "",
      skonto: "",
      skontozahl: "",
      skontobis: "",
    });
    setStatus("");
    setBeleg("");
  };

  const colInput = (col: TextCol, align: "left" | "right" = "left") => (
    <input
      value={text[col]}
      onChange={(e) => setCol(col, e.target.value)}
      placeholder="Filter"
      className={`${filterInputClass} ${align === "right" ? "text-right" : ""}`}
    />
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-gray-200 px-5 py-4">
        <h2 className="text-lg font-medium text-gray-900">Erfasste Belege {periodLabel}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-gray-600">
            {filtered.length} {filtered.length === 1 ? "Beleg" : "Belege"} · {currencyFormatter.format(total)}
          </p>
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            title="Liste der angezeigten Belege als CSV (für den Steuerberater)"
            className="rounded-md border border-gray-300 px-2.5 py-1 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900 disabled:opacity-50"
          >
            ⬇ CSV ({filtered.length})
          </button>
          <button
            type="button"
            onClick={exportPdfs}
            disabled={zipping !== null || withFileCount === 0}
            title="Alle Beleg-Dateien der Anzeige als ZIP (für den Steuerberater)"
            className="rounded-md border border-gray-300 px-2.5 py-1 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900 disabled:opacity-50"
          >
            {zipping ? `Belege … ${zipping}` : `⬇ Belege (PDF-ZIP) (${withFileCount})`}
          </button>
          {anyFilter && (
            <button
              type="button"
              onClick={reset}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
            >
              Filter zurücksetzen
            </button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-gray-500">Keine manuellen Belege in diesem Zeitraum.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-3 py-1.5 font-semibold" title="Eindeutige, fortlaufende Beleg-ID (zum Melden von Problemen)">ID</th>
              <th className="px-3 py-1.5 font-semibold">Datum</th>
              <th className="px-3 py-1.5 font-semibold">Lieferant</th>
              <th className="px-3 py-1.5 font-semibold">Beleg-Nr.</th>
              <th className="px-3 py-1.5 font-semibold">Konto</th>
              <th className="px-3 py-1.5 font-semibold">Projekt</th>
              <th className="px-3 py-1.5 text-right font-semibold">Netto</th>
              <th className="px-3 py-1.5 text-right font-semibold">MwSt</th>
              <th className="px-3 py-1.5 text-right font-semibold">Brutto</th>
              <th className="px-3 py-1.5 text-right font-semibold">Skonto €</th>
              <th className="px-3 py-1.5 text-right font-semibold">Skontozahlbetrag</th>
              <th className="px-3 py-1.5 font-semibold">Skonto bis</th>
              <th className="px-3 py-1.5 font-semibold">Status</th>
              <th className="px-3 py-1.5 font-semibold">Beleg</th>
              <th className="px-3 py-1.5 font-semibold">Aktion</th>
            </tr>
            {/* Filterzeile im Tabellenkopf */}
            <tr className="border-t border-gray-200 bg-white align-top">
              <th className="px-2 py-1.5">{colInput("id")}</th>
              <th className="px-2 py-1.5">{colInput("datum")}</th>
              <th className="px-2 py-1.5">{colInput("lieferant")}</th>
              <th className="px-2 py-1.5">{colInput("belegnr")}</th>
              <th className="px-2 py-1.5">{colInput("konto")}</th>
              <th className="px-2 py-1.5">{colInput("projekt")}</th>
              <th className="px-2 py-1.5">{colInput("netto", "right")}</th>
              <th className="px-2 py-1.5">{colInput("mwst", "right")}</th>
              <th className="px-2 py-1.5">{colInput("brutto", "right")}</th>
              <th className="px-2 py-1.5">{colInput("skonto", "right")}</th>
              <th className="px-2 py-1.5">{colInput("skontozahl", "right")}</th>
              <th className="px-2 py-1.5">{colInput("skontobis")}</th>
              <th className="px-2 py-1.5">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "" | "open" | "paid")}
                  className={filterInputClass}
                >
                  <option value="">Alle</option>
                  <option value="open">Offen</option>
                  <option value="paid">Bezahlt</option>
                </select>
              </th>
              <th className="px-2 py-1.5">
                <select
                  value={beleg}
                  onChange={(e) => setBeleg(e.target.value as "" | "with" | "without")}
                  className={filterInputClass}
                >
                  <option value="">Alle</option>
                  <option value="with">Mit</option>
                  <option value="without">Ohne</option>
                </select>
              </th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={15} className="px-5 py-8 text-center text-sm text-gray-500">
                  Keine Belege für die gewählten Spaltenfilter.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="px-3 py-1.5 tabular-nums font-semibold text-gray-500" title="Eindeutige, fortlaufende Beleg-ID">
                    #{r.id}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-gray-700">{formatDate(r.date)}</td>
                  <td className="px-3 py-1.5 text-gray-900">
                    {r.supplier ?? "—"}
                    {r.confidential && (
                      <span
                        title="Vertraulich (z. B. Lohn) – von Rechnungsprüfung/Workflow-Automatik ausgeschlossen"
                        className="ml-1.5 whitespace-nowrap rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-violet-500/40"
                      >
                        🔒 Vertraulich
                      </span>
                    )}
                    {r.duplicate && (
                      <span
                        title="Mögliche Dublette: gleicher Lieferant, Betrag und Datum wie ein anderer Beleg"
                        className="ml-1.5 whitespace-nowrap rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-500/40"
                      >
                        ⚠ Dublette
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-gray-700">{r.invoiceNumber ?? "—"}</td>
                  <td className="px-3 py-1.5 text-gray-700">
                    {r.accountNumber ? `${r.accountNumber} ${r.accountName ?? ""}` : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-gray-700">
                    {r.projectId ? (
                      <a
                        href={`/dashboard/projekte/${r.projectId}?${new URLSearchParams({
                          ...(r.projectName ? { name: r.projectName } : {}),
                          ...(r.projectRelativeId != null ? { nr: String(r.projectRelativeId) } : {}),
                        }).toString()}`}
                        className="text-brand-red hover:underline"
                      >
                        {r.projectRelativeId != null ? `#${r.projectRelativeId} ` : ""}
                        {r.projectName ?? "Projekt"}
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{currencyFormatter.format(r.net)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{currencyFormatter.format(r.vat)}</td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums text-gray-900">
                    {currencyFormatter.format(r.gross)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                    {r.skontoAmount != null ? currencyFormatter.format(r.skontoAmount) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                    {r.skontoPayAmount != null ? currencyFormatter.format(r.skontoPayAmount) : "—"}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-gray-700">{formatDate(r.skontoDueDate)}</td>
                  <td className="px-3 py-1.5">
                    <PaidCell r={r} />
                  </td>
                  <td className="px-3 py-1.5">
                    {r.hasFile ? (
                      <a
                        href={`/api/beleg?id=${r.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-red hover:underline"
                      >
                        ansehen
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <BelegEditButton accounts={accounts} projects={projects} suppliers={suppliers} receipt={r} hasFile={r.hasFile} />
                      <DeleteBelegButton id={r.id} label={r.supplier ?? r.description ?? `Beleg ${r.id}`} />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
