"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setBelegPaidAction,
  deleteBelegAction,
  saveBelegColumnsAction,
} from "@/app/dashboard/belege/manual-actions";
import { buildMultilineSepaAction, type SepaItem } from "@/app/dashboard/belege/sepa-actions";
import BelegDetailModal from "@/components/BelegDetailModal";
import type { ProjectOption, SupplierOption } from "@/components/ManualBelegeForm";
import type { ManualReceipt } from "@/lib/manual-receipts";

/** Ein-/ausblendbare Spalten der Tabelle (Reihenfolge = Menü-Reihenfolge). */
const TOGGLE_COLUMNS: { key: string; label: string }[] = [
  { key: "id", label: "ID" },
  { key: "datum", label: "Datum" },
  { key: "lieferant", label: "Lieferant" },
  { key: "belegnr", label: "Beleg-Nr." },
  { key: "konto", label: "Konto" },
  { key: "projekt", label: "Projekt" },
  { key: "netto", label: "Netto" },
  { key: "mwst", label: "MwSt" },
  { key: "brutto", label: "Brutto" },
  { key: "skonto", label: "Skonto €" },
  { key: "skontozahl", label: "Skontozahlbetrag" },
  { key: "skontobis", label: "Skonto bis" },
  { key: "status", label: "Status" },
];

type AccountOption = { number: string; name: string };
export type BelegRow = ManualReceipt & { duplicate: boolean };

const currencyFormatter = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const dateFormatter = new Intl.DateTimeFormat("de-DE");

function formatDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? d : dateFormatter.format(dt);
}

/** Reguläres Zahlungsziel (netto), wenn keins am Beleg hinterlegt ist: Belegdatum + N Tage. */
const NET_DAYS = 30;

/** Lokales Datum als yyyy-mm-dd (kein UTC-Versatz). */
const localISO = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** yyyy-mm-dd + n Tage → yyyy-mm-dd. */
const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localISO(d);
};

/**
 * Zeilenfarbe nach Zahlstatus (Dark-Theme-lesbar, halbtransparent):
 *  grün = bezahlt · blau = Skonto noch ziehbar · orange = noch im Zahlungsziel · rot = überfällig.
 */
function rowTint(r: BelegRow, todayISO: string): string {
  if (r.isPaid) return "bg-green-500/30 hover:bg-green-500/40";
  const skontoOpen =
    r.skontoPayAmount != null &&
    r.skontoPayAmount < r.gross &&
    r.skontoDueDate != null &&
    r.skontoDueDate >= todayISO;
  if (skontoOpen) return "bg-blue-500/30 hover:bg-blue-500/40";
  const due = r.date ? addDays(r.date, NET_DAYS) : null;
  // Warme Töne brauchen im dunklen Theme mehr Deckkraft + helleren Grundton,
  // sonst wirken sie matschig-braun. Orange (Ziel) klar von Rot (überfällig) getrennt.
  if (!due || todayISO <= due) return "bg-orange-400/60 hover:bg-orange-400/70";
  return "bg-red-600/55 hover:bg-red-600/65";
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
  hiddenColumns = [],
}: {
  rows: BelegRow[];
  accounts: AccountOption[];
  projects: ProjectOption[];
  suppliers: SupplierOption[];
  periodLabel: string;
  /** Pro-User ausgeblendete Spalten-Keys (aus der gespeicherten Konfiguration). */
  hiddenColumns?: string[];
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
  // Sortierung nach ID oder Datum. Standard beim Öffnen: Datum, neueste zuerst.
  const [sort, setSort] = useState<{ col: "id" | "datum"; dir: "asc" | "desc" }>({ col: "datum", dir: "desc" });
  const toggleSort = (col: "id" | "datum") =>
    setSort((s) => (s?.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: "desc" }));
  const sortArrow = (col: "id" | "datum") => (sort?.col === col ? (sort.dir === "asc" ? " ▲" : " ▼") : "");

  // Spalten ein-/ausblenden (pro User gespeichert). show(key) = Spalte sichtbar.
  const [hidden, setHidden] = useState<Set<string>>(new Set(hiddenColumns));
  const [colMenu, setColMenu] = useState(false);
  const show = (key: string) => !hidden.has(key);
  const toggleColumn = (key: string) => {
    setHidden((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      // Persistieren (pro User); UI reagiert sofort, Speichern läuft im Hintergrund.
      void saveBelegColumnsAction([...n]);
      return n;
    });
  };
  const showAllColumns = () => {
    setHidden(new Set());
    void saveBelegColumnsAction([]);
  };
  // Sichtbare Datenspalten + Auswahlspalte → für colSpan der Leer-Zeile.
  const visibleColSpan = 1 + TOGGLE_COLUMNS.filter((c) => show(c.key)).length;
  // Heutiges Datum (lokal) für die Fälligkeits-Einfärbung der Zeilen.
  const todayISO = localISO(new Date());

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
      const v = searchValues.get(r.id);
      if (!v) return true;
      for (const [col, q] of active) {
        if (!v[col].toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, text, status, searchValues]);

  // Sortierte Anzeige (Datum als ISO yyyy-mm-dd → lexikografisch = chronologisch;
  // leere Daten ans Ende). Bei gleichem Datum als Zweitschlüssel die ID.
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      if (sort.col === "id") {
        return sort.dir === "asc" ? a.id - b.id : b.id - a.id;
      }
      // Datum: leere Daten IMMER ans Ende (unabhängig von der Richtung).
      const da = a.date ?? "";
      const db = b.date ?? "";
      if (!da && !db) return a.id - b.id;
      if (!da) return 1;
      if (!db) return -1;
      const cmp = da.localeCompare(db) || a.id - b.id;
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sort]);

  const total = filtered.reduce((s, r) => s + r.gross, 0);
  const anyFilter = status !== "" || TEXT_COLS.some((c) => text[c].trim() !== "");

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
    const withFile = sorted.filter((r) => r.hasFile);
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
    const lines = sorted.map((r) =>
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

  // --- Multiline SEPA-Export (offene manuelle Belege bezahlen) ---
  // Nutzt dieselbe Server-Aktion wie die HERO-Belege; die IBAN wird dort über
  // den Lieferantennamen (→ HERO-Kontakt) aufgelöst. Nur OFFENE Belege wählbar.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sepaBusy, setSepaBusy] = useState(false);
  const [sepaError, setSepaError] = useState<string | null>(null);
  const [sepaMissing, setSepaMissing] = useState<{ name: string }[] | null>(null);

  const selectable = filtered.filter((r) => !r.isPaid);
  const selectedRows = selectable.filter((r) => selected.has(r.id));
  const allSelectableSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));
  const toggleRow = (id: number) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (allSelectableSelected) selectable.forEach((r) => n.delete(r.id));
      else selectable.forEach((r) => n.add(r.id));
      return n;
    });

  const runSepa = async () => {
    if (selectedRows.length === 0) return;
    setSepaBusy(true);
    setSepaError(null);
    setSepaMissing(null);
    try {
      const items: SepaItem[] = selectedRows.map((r) => ({
        customerId: null, // manueller Beleg → Auflösung über den Lieferantennamen
        name: r.supplier ?? "",
        // Voller Bruttobetrag (Skonto wird hier bewusst nicht automatisch gezogen).
        amount: r.gross,
        reference: r.invoiceNumber || `Beleg ${r.id}`,
      }));
      const res = await buildMultilineSepaAction(items);
      if (res.error) {
        setSepaError(res.error);
        return;
      }
      if (res.missing.length > 0) {
        setSepaMissing(res.missing.map((m) => ({ name: m.name })));
        return;
      }
      if (res.xml && res.filename) {
        const blob = new Blob([res.xml], { type: "application/xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = res.filename;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      setSepaError("SEPA-Export fehlgeschlagen.");
    } finally {
      setSepaBusy(false);
    }
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
  };

  // --- Zeilen-Aktionen per Rechtsklick (Kontextmenü) ---
  const router = useRouter();
  const [, startDelete] = useTransition();
  const [menu, setMenu] = useState<{ row: BelegRow; x: number; y: number } | null>(null);
  const [editRow, setEditRow] = useState<BelegRow | null>(null);

  const doDelete = (row: BelegRow) => {
    setMenu(null);
    const label = row.supplier ?? row.description ?? `Beleg ${row.id}`;
    if (!window.confirm(`Beleg „${label}" (#${row.id}) wirklich löschen?`)) return;
    const fd = new FormData();
    fd.set("id", String(row.id));
    startDelete(async () => {
      await deleteBelegAction(fd);
      router.refresh();
    });
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
    <>
    <div className="overflow-x-auto rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-gray-200 px-5 py-4">
        <h2 className="text-lg font-medium text-gray-900">Erfasste Belege {periodLabel}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-gray-600">
            {filtered.length} {filtered.length === 1 ? "Beleg" : "Belege"} · {currencyFormatter.format(total)}
          </p>
          {sepaError && <span className="text-sm text-rose-600">{sepaError}</span>}
          <button
            type="button"
            onClick={runSepa}
            disabled={sepaBusy || selectedRows.length === 0}
            title="Ausgewählte offene Belege als SEPA-Sammelüberweisung (XML) exportieren – IBAN kommt aus den Lieferanten-IBANs"
            className="rounded-md bg-brand-red px-3 py-1 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {sepaBusy ? "Erzeuge SEPA …" : `Multiline SEPA-Export (${selectedRows.length})`}
          </button>
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
          <div className="relative">
            <button
              type="button"
              onClick={() => setColMenu((v) => !v)}
              title="Spalten ein-/ausblenden (wird pro Benutzer gespeichert)"
              className="rounded-md border border-gray-300 px-2.5 py-1 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
            >
              ⚙ Spalten
            </button>
            {colMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setColMenu(false)} />
                <div className="absolute right-0 z-50 mt-1 max-h-80 w-56 overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-xl">
                  {TOGGLE_COLUMNS.map((c) => (
                    <label
                      key={c.key}
                      className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={show(c.key)}
                        onChange={() => toggleColumn(c.key)}
                        className="h-4 w-4 accent-brand-red"
                      />
                      {c.label}
                    </label>
                  ))}
                  <div className="mt-1 border-t border-gray-100 px-3 py-1.5">
                    <button
                      type="button"
                      onClick={showAllColumns}
                      className="text-xs font-medium text-brand-red hover:underline"
                    >
                      Alle anzeigen
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
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

      {sepaMissing && sepaMissing.length > 0 && (
        <div className="border-b border-amber-300 bg-amber-50 px-5 py-3 text-sm text-amber-900">
          <p className="font-semibold">
            Für folgende Lieferanten fehlt eine IBAN – bitte erst pflegen, dann erneut exportieren:
          </p>
          <p className="mt-1">{[...new Set(sepaMissing.map((m) => m.name || "—"))].join(", ")}</p>
          <a
            href="/dashboard/belege/ibans"
            className="mt-1 inline-block font-medium text-brand-red hover:underline"
          >
            → Lieferanten-IBANs pflegen
          </a>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-gray-500">Keine manuellen Belege in diesem Zeitraum.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-3 py-1.5 font-semibold" title="Offene Belege für den SEPA-Export auswählen">
                <input
                  type="checkbox"
                  checked={allSelectableSelected}
                  onChange={toggleAll}
                  disabled={selectable.length === 0}
                  className="h-4 w-4 cursor-pointer accent-brand-red disabled:opacity-40"
                  title="Alle offenen Belege der Anzeige auswählen"
                />
              </th>
              {show("id") && (
                <th className="px-3 py-1.5 font-semibold" title="Eindeutige, fortlaufende Beleg-ID (zum Melden von Problemen). Klicken zum Sortieren.">
                  <button type="button" onClick={() => toggleSort("id")} className="uppercase tracking-wide hover:text-gray-800">
                    ID{sortArrow("id")}
                  </button>
                </th>
              )}
              {show("datum") && (
                <th className="px-3 py-1.5 font-semibold" title="Nach Datum sortieren">
                  <button type="button" onClick={() => toggleSort("datum")} className="uppercase tracking-wide hover:text-gray-800">
                    Datum{sortArrow("datum")}
                  </button>
                </th>
              )}
              {show("lieferant") && <th className="px-3 py-1.5 font-semibold">Lieferant</th>}
              {show("belegnr") && <th className="px-3 py-1.5 font-semibold">Beleg-Nr.</th>}
              {show("konto") && <th className="px-3 py-1.5 font-semibold">Konto</th>}
              {show("projekt") && <th className="px-3 py-1.5 font-semibold">Projekt</th>}
              {show("netto") && <th className="px-3 py-1.5 text-right font-semibold">Netto</th>}
              {show("mwst") && <th className="px-3 py-1.5 text-right font-semibold">MwSt</th>}
              {show("brutto") && <th className="px-3 py-1.5 text-right font-semibold">Brutto</th>}
              {show("skonto") && <th className="px-3 py-1.5 text-right font-semibold">Skonto €</th>}
              {show("skontozahl") && <th className="px-3 py-1.5 text-right font-semibold">Skontozahlbetrag</th>}
              {show("skontobis") && <th className="px-3 py-1.5 font-semibold">Skonto bis</th>}
              {show("status") && <th className="px-3 py-1.5 font-semibold">Status</th>}
            </tr>
            {/* Filterzeile im Tabellenkopf */}
            <tr className="border-t border-gray-200 bg-white align-top">
              <th className="px-2 py-1.5" />
              {show("id") && <th className="px-2 py-1.5">{colInput("id")}</th>}
              {show("datum") && <th className="px-2 py-1.5">{colInput("datum")}</th>}
              {show("lieferant") && <th className="px-2 py-1.5">{colInput("lieferant")}</th>}
              {show("belegnr") && <th className="px-2 py-1.5">{colInput("belegnr")}</th>}
              {show("konto") && <th className="px-2 py-1.5">{colInput("konto")}</th>}
              {show("projekt") && <th className="px-2 py-1.5">{colInput("projekt")}</th>}
              {show("netto") && <th className="px-2 py-1.5">{colInput("netto", "right")}</th>}
              {show("mwst") && <th className="px-2 py-1.5">{colInput("mwst", "right")}</th>}
              {show("brutto") && <th className="px-2 py-1.5">{colInput("brutto", "right")}</th>}
              {show("skonto") && <th className="px-2 py-1.5">{colInput("skonto", "right")}</th>}
              {show("skontozahl") && <th className="px-2 py-1.5">{colInput("skontozahl", "right")}</th>}
              {show("skontobis") && <th className="px-2 py-1.5">{colInput("skontobis")}</th>}
              {show("status") && (
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
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={visibleColSpan} className="px-5 py-8 text-center text-sm text-gray-500">
                  Keine Belege für die gewählten Spaltenfilter.
                </td>
              </tr>
            ) : (
              sorted.map((r) => (
                <tr
                  key={r.id}
                  className={`border-t border-gray-100 ${rowTint(r, todayISO)}`}
                  title="Rechtsklick für Aktionen (Bearbeiten / Löschen)"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({
                      row: r,
                      x: Math.min(e.clientX, window.innerWidth - 180),
                      y: Math.min(e.clientY, window.innerHeight - 90),
                    });
                  }}
                >
                  <td className="px-3 py-1.5">
                    {!r.isPaid && (
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggleRow(r.id)}
                        className="h-4 w-4 cursor-pointer accent-brand-red"
                        title="Für SEPA-Sammelüberweisung auswählen"
                      />
                    )}
                  </td>
                  {show("id") && (
                    <td className="px-3 py-1.5 tabular-nums font-semibold text-gray-500" title="Eindeutige, fortlaufende Beleg-ID">
                      #{r.id}
                    </td>
                  )}
                  {show("datum") && <td className="px-3 py-1.5 tabular-nums text-gray-700">{formatDate(r.date)}</td>}
                  {show("lieferant") && (
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
                  )}
                  {show("belegnr") && <td className="px-3 py-1.5 tabular-nums text-gray-700">{r.invoiceNumber ?? "—"}</td>}
                  {show("konto") && (
                    <td className="px-3 py-1.5 text-gray-700">
                      {r.accountNumber ? `${r.accountNumber} ${r.accountName ?? ""}` : "—"}
                    </td>
                  )}
                  {show("projekt") && (
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
                  )}
                  {show("netto") && <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{currencyFormatter.format(r.net)}</td>}
                  {show("mwst") && <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{currencyFormatter.format(r.vat)}</td>}
                  {show("brutto") && (
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums text-gray-900">
                      {currencyFormatter.format(r.gross)}
                    </td>
                  )}
                  {show("skonto") && (
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                      {r.skontoAmount != null ? currencyFormatter.format(r.skontoAmount) : "—"}
                    </td>
                  )}
                  {show("skontozahl") && (
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                      {r.skontoPayAmount != null ? currencyFormatter.format(r.skontoPayAmount) : "—"}
                    </td>
                  )}
                  {show("skontobis") && <td className="px-3 py-1.5 tabular-nums text-gray-700">{formatDate(r.skontoDueDate)}</td>}
                  {show("status") && (
                    <td className="px-3 py-1.5">
                      <PaidCell r={r} />
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>

    {/* Rechtsklick-Kontextmenü mit den Zeilen-Aktionen. */}
    {menu && (
      <>
        <div
          className="fixed inset-0 z-40"
          onClick={() => setMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu(null);
          }}
        />
        <div
          className="fixed z-50 w-44 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-xl"
          style={{ left: menu.x, top: menu.y }}
        >
          {menu.row.hasFile && (
            <button
              type="button"
              onClick={() => {
                window.open(`/api/beleg?id=${menu.row.id}`, "_blank", "noopener,noreferrer");
                setMenu(null);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              👁 Ansehen
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setEditRow(menu.row);
              setMenu(null);
            }}
            className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            ✏️ Bearbeiten
          </button>
          <button
            type="button"
            onClick={() => doDelete(menu.row)}
            className="block w-full px-3 py-2 text-left text-sm font-medium text-brand-red hover:bg-gray-50"
          >
            🗑 Löschen
          </button>
        </div>
      </>
    )}

    {/* Bearbeiten-Fenster (dasselbe wie zuvor der „Bearbeiten"-Button). */}
    {editRow && (
      <BelegDetailModal
        belegId={editRow.id}
        receipt={editRow}
        accounts={accounts}
        projects={projects}
        suppliers={suppliers}
        hasFile={editRow.hasFile}
        onClose={() => setEditRow(null)}
      />
    )}
    </>
  );
}
