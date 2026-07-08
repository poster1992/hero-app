"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ProjectRow } from "@/components/ProjectsTable";
import {
  getProjectReceipts,
  getProjectHoursByEmployee,
  getProjectCalculatedMaterials,
  getProjectBookedMaterials,
  type ProjectReceiptItem,
  type ProjectEmployeeHours,
} from "@/app/dashboard/projekte/receipts-actions";
import ProjectPhotosButton from "@/components/ProjectPhotosButton";
import ProjectDocumentsButton from "@/components/ProjectDocumentsButton";
import LogbookButton from "@/components/LogbookButton";
import {
  getProjectBelegArticles,
  getProjectMaterialMappings,
  saveProjectMaterialMapping,
  removeProjectMaterialMapping,
  excludeProjectBelegArticle,
  restoreProjectBelegArticle,
  resetProjectMaterialAssignment,
  type ProjectBelegMaterials,
} from "@/app/dashboard/projekte/material-ocr-actions";
import type { ProjectMaterialCalculation } from "@/lib/hero-api";
import type { ProjectBookedMaterials } from "@/lib/materials";

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const euro0 = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const hours = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat("de-DE");

/** One line of the value breakdown: "Label = a − b = result". */
function Calc({
  label,
  formula,
  result,
  tone = "neutral",
}: {
  label: string;
  formula: string;
  result: string;
  tone?: "neutral" | "pos" | "neg";
}) {
  const color =
    tone === "pos" ? "text-emerald-600" : tone === "neg" ? "text-brand-red" : "text-gray-900";
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-gray-100 py-2">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <span className="flex-1 text-right text-xs text-gray-500">{formula}</span>
      <span className={`w-32 text-right text-sm font-semibold tabular-nums ${color}`}>{result}</span>
    </div>
  );
}

interface MergedMatRow {
  name: string;
  unit: string | null;
  sollQty: number;
  sollEk: number;
  istQty: number;
  istValue: number;
  /** Abweichende Ist-Artikelnamen, die per Ähnlichkeit zugeordnet wurden. */
  istAltNames: string[];
  /** Manuell (Drag & Drop) zugeordnete Ist-Artikelnamen. */
  manualAltNames: string[];
  /** Aus Belegen stammende Artikelnamen, die zu dieser Zeile beitragen (entfernbar). */
  belegNames: string[];
}

/** Generische Ist-Position (aus Lagerbuchung ODER Beleg-OCR). */
interface IstItem {
  name: string;
  unit: string | null;
  quantity: number;
  value: number;
  source: "lager" | "beleg";
}

// --- Artikel-Ähnlichkeit (Wahrscheinlichkeitsprüfung für die Soll/Ist-Zuordnung) ---
const translitMat = (s: string) =>
  s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
/** Normalisierter Schlüssel: nur Buchstaben/Ziffern, Umlaute transliteriert. */
const normKey = (s: string) => translitMat(s).replace(/[^a-z0-9]/g, "");

/** Dice-Koeffizient über Zeichen-Bigramme (typo-/kompositum-tolerant). */
function bigramDice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const count = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    count.set(g, (count.get(g) ?? 0) + 1);
  }
  let inter = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const c = count.get(g);
    if (c && c > 0) {
      inter++;
      count.set(g, c - 1);
    }
  }
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

/** Ähnlichkeit zweier Artikelnamen in [0..1] (1 = identisch). */
function articleSimilarity(a: string, b: string): number {
  const na = normKey(a);
  const nb = normKey(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  // Enthaltensein (z.B. "abdeckvlies" in "malerabdeckvlies") = sehr wahrscheinlich derselbe Artikel.
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) return 0.92;
  return bigramDice(na, nb);
}

/** Ab dieser Wahrscheinlichkeit gilt ein Ist-Artikel als „derselbe" wie ein Soll-Artikel. */
const MATCH_THRESHOLD = 0.6;

/**
 * Führt kalkuliertes (Soll) und tatsächliches (Ist) Material je Artikel zusammen.
 * Ist-Artikel werden per Ähnlichkeits-/Wahrscheinlichkeitsprüfung dem passenden
 * Soll-Artikel zugeordnet (statt nur bei exakt gleichem Namen).
 */
function mergeMaterials(
  calc: ProjectMaterialCalculation | null,
  istItems: IstItem[],
  manualMap: Map<string, string>
): MergedMatRow[] {
  const rows: MergedMatRow[] = [];
  const newRow = (name: string, unit: string | null): MergedMatRow => ({
    name,
    unit,
    sollQty: 0,
    sollEk: 0,
    istQty: 0,
    istValue: 0,
    istAltNames: [],
    manualAltNames: [],
    belegNames: [],
  });
  const noteBeleg = (row: MergedMatRow, it: IstItem) => {
    if (it.source === "beleg" && !row.belegNames.includes(it.name)) row.belegNames.push(it.name);
  };

  // 1) Soll-Artikel als Basiszeilen (gleiche Bezeichnung zusammengefasst).
  for (const it of calc?.items ?? []) {
    const found = rows.find((r) => normKey(r.name) === normKey(it.name));
    const r = found ?? rows[rows.push(newRow(it.name, it.unit)) - 1];
    r.sollQty += it.quantity;
    r.sollEk += it.lineTotal;
    if (!r.unit) r.unit = it.unit;
  }

  // 2) Ist-Artikel zuordnen: zuerst manuelle Zuordnung, sonst Ähnlichkeit.
  for (const it of istItems) {
    const istKey = normKey(it.name);

    // a) Manuelle (gespeicherte) Zuordnung hat Vorrang.
    const mappedSollKey = manualMap.get(istKey);
    if (mappedSollKey) {
      const target = rows.find((r) => normKey(r.name) === mappedSollKey);
      if (target) {
        target.istQty += it.quantity;
        target.istValue += it.value;
        if (!target.unit) target.unit = it.unit;
        if (normKey(target.name) !== istKey && !target.manualAltNames.includes(it.name)) {
          target.manualAltNames.push(it.name);
        }
        noteBeleg(target, it);
        continue;
      }
    }

    // b) Automatische Ähnlichkeits-Zuordnung (Soll-Zeilen bevorzugt).
    let best: MergedMatRow | null = null;
    let bestScore = MATCH_THRESHOLD;
    for (const r of rows) {
      const score = articleSimilarity(r.name, it.name);
      if (score < MATCH_THRESHOLD) continue;
      const adj = score + (r.sollQty > 0 || r.sollEk > 0 ? 0.001 : 0);
      if (adj > bestScore) {
        bestScore = adj;
        best = r;
      }
    }
    if (best) {
      best.istQty += it.quantity;
      best.istValue += it.value;
      if (!best.unit) best.unit = it.unit;
      if (normKey(best.name) !== istKey && !best.istAltNames.includes(it.name)) {
        best.istAltNames.push(it.name);
      }
      noteBeleg(best, it);
    } else {
      const r = newRow(it.name, it.unit);
      r.istQty = it.quantity;
      r.istValue = it.value;
      noteBeleg(r, it);
      rows.push(r);
    }
  }

  return rows.sort((a, b) => Math.max(b.sollEk, b.istValue) - Math.max(a.sollEk, a.istValue));
}

export default function ProjectDetailModal({
  project,
  onClose,
  canFinance = true,
}: {
  project: ProjectRow | null;
  onClose: () => void;
  /** Darf der Nutzer Kosten/Ertrag/Belege sehen? Ohne dieses Recht wird eine
   *  reduzierte Ansicht gezeigt (nur Auftrag/Rechnungen/Offen, Stunden, Material-Mengen). */
  canFinance?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [receipts, setReceipts] = useState<ProjectReceiptItem[] | null>(null);
  const [loadingReceipts, setLoadingReceipts] = useState(false);
  const [empHours, setEmpHours] = useState<ProjectEmployeeHours[] | null>(null);
  const [loadingHours, setLoadingHours] = useState(false);
  const [calcMat, setCalcMat] = useState<ProjectMaterialCalculation | null>(null);
  const [loadingCalcMat, setLoadingCalcMat] = useState(false);
  const [bookedMat, setBookedMat] = useState<ProjectBookedMaterials | null>(null);
  const [loadingBookedMat, setLoadingBookedMat] = useState(false);
  const [belegMat, setBelegMat] = useState<ProjectBelegMaterials | null>(null);
  const [loadingBelegMat, setLoadingBelegMat] = useState(false);
  // Manuelle Soll/Ist-Zuordnungen (ist_key → soll_key), per Drag & Drop, persistiert.
  const [manualMap, setManualMap] = useState<Map<string, string>>(new Map());
  const [dragName, setDragName] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [emailing, setEmailing] = useState(false);

  useEffect(() => {
    if (!project) {
      setReceipts(null);
      setEmpHours(null);
      return;
    }
    let cancelled = false;
    setLoadingCalcMat(true);
    setCalcMat(null);
    // Belege & Mitarbeiter-Stunden nur laden, wenn der Nutzer sie sehen darf
    // (Finanz-Recht) – sonst gar nicht erst zum Client übertragen.
    if (canFinance) {
      setLoadingReceipts(true);
      setLoadingHours(true);
      setReceipts(null);
      setEmpHours(null);
      getProjectReceipts(project.id)
        .then((r) => !cancelled && setReceipts(r))
        .catch(() => !cancelled && setReceipts([]))
        .finally(() => !cancelled && setLoadingReceipts(false));
      getProjectHoursByEmployee(project.id)
        .then((h) => !cancelled && setEmpHours(h))
        .catch(() => !cancelled && setEmpHours([]))
        .finally(() => !cancelled && setLoadingHours(false));
    } else {
      setReceipts([]);
      setEmpHours([]);
      setLoadingReceipts(false);
      setLoadingHours(false);
    }
    getProjectCalculatedMaterials(project.id)
      .then((m) => !cancelled && setCalcMat(m))
      .catch(() => !cancelled && setCalcMat({ hours: 0, materialTotal: 0, laborCost: 0, items: [] }))
      .finally(() => !cancelled && setLoadingCalcMat(false));
    setLoadingBookedMat(true);
    setBookedMat(null);
    if (project.relativeId != null) {
      getProjectBookedMaterials(project.relativeId)
        .then((m) => !cancelled && setBookedMat(m))
        .catch(() => !cancelled && setBookedMat({ items: [], total: 0 }))
        .finally(() => !cancelled && setLoadingBookedMat(false));
    } else {
      setBookedMat({ items: [], total: 0 });
      setLoadingBookedMat(false);
    }
    // Artikel aus den zugeordneten Belegen per OCR (gecacht) → Ist.
    setLoadingBelegMat(true);
    setBelegMat(null);
    getProjectBelegArticles(project.id)
      .then((m) => !cancelled && setBelegMat(m))
      .catch(() => !cancelled && setBelegMat({ items: [], total: 0, belegeCount: 0, ocrCostEur: 0, excluded: [] }))
      .finally(() => !cancelled && setLoadingBelegMat(false));
    // Manuelle Zuordnungen laden.
    setManualMap(new Map());
    getProjectMaterialMappings(project.id)
      .then((rows) => {
        if (cancelled) return;
        setManualMap(new Map(rows.map((r) => [r.istKey, r.sollKey])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project, canFinance]);

  useEffect(() => {
    if (!project) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [project, onClose]);

  if (!project || !mounted) return null;
  const p = project;

  // Abgeleitete Werte (gleiche Formeln wie in der Tabelle).
  const open = Math.max(0, p.confirmationNet - p.invoiceNet);
  // Ist-Material gesamt = Belege (costNet) + aufs Projekt gebuchte Lagerware (stockNet).
  const istMaterialTotal = p.costNet + p.stockNet;
  const restMaterial = p.calcMaterial - istMaterialTotal;
  const restHours = p.calcHours - p.hours;
  const rate = p.calcHours > 0 ? p.sollLabor / p.calcHours : 0;
  const istLabor = p.hours * rate;
  const sollErtrag = p.confirmationNet - p.calcMaterial - p.sollLabor;
  const istErtrag = p.invoiceNet - istMaterialTotal - istLabor;

  // Manuelle Zuordnung speichern (Drag Ist-Artikel → Drop auf Soll-Artikel).
  const assignMapping = (istName: string, sollName: string) => {
    if (!istName || normKey(istName) === normKey(sollName)) return;
    setManualMap((prev) => {
      const next = new Map(prev);
      next.set(normKey(istName), normKey(sollName));
      return next;
    });
    void saveProjectMaterialMapping(p.id, istName, sollName);
  };
  // Manuelle Zuordnung wieder lösen.
  const unassignMapping = (istName: string) => {
    setManualMap((prev) => {
      const next = new Map(prev);
      next.delete(normKey(istName));
      return next;
    });
    void removeProjectMaterialMapping(p.id, istName);
  };

  // Beleg-Ist neu vom Server laden (nach Entfernen/Wiederherstellen/Reset).
  const reloadBelegMat = async () => {
    setLoadingBelegMat(true);
    try {
      setBelegMat(await getProjectBelegArticles(p.id));
    } catch {
      /* ignore */
    } finally {
      setLoadingBelegMat(false);
    }
  };

  // Einen über Belege zugeordneten Artikel aus dem Ist entfernen.
  const excludeBeleg = async (istName: string) => {
    await excludeProjectBelegArticle(p.id, istName);
    await reloadBelegMat();
  };
  // Entfernten Beleg-Artikel wiederherstellen.
  const restoreBeleg = async (istName: string) => {
    await restoreProjectBelegArticle(p.id, istName);
    await reloadBelegMat();
  };

  // Komplette Zuordnung löschen und neu erstellen (frisches OCR + leere Zuordnungen).
  const resetAssignment = async () => {
    if (!window.confirm("Komplette Material-Zuordnung dieses Projekts löschen und neu erstellen? Die Belege werden erneut ausgelesen.")) {
      return;
    }
    setResetting(true);
    try {
      await resetProjectMaterialAssignment(p.id);
      setManualMap(new Map());
      await reloadBelegMat();
      try {
        const rows = await getProjectMaterialMappings(p.id);
        setManualMap(new Map(rows.map((r) => [r.istKey, r.sollKey])));
      } catch {
        /* ignore */
      }
    } finally {
      setResetting(false);
    }
  };

  // Drucken: Dokumenttitel temporär umstellen, damit "HERO Dashboard" nicht in
  // der Browser-Druckkopfzeile erscheint.
  const handlePrint = () => {
    const prev = document.title;
    document.title = `Projekt ${p.relativeId != null ? `Nr. ${p.relativeId} ` : ""}${p.name}`;
    const restore = () => {
      document.title = prev;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  };

  // PDF des Popups erzeugen und als .eml-Entwurf herunterladen → Outlook öffnet
  // ein neues Mail-Fenster mit dem PDF als Anhang (X-Unsent: 1).
  const emailAsPdf = async () => {
    const el = document.getElementById("project-print-area");
    if (!el) return;
    setEmailing(true);
    const scroll = el.querySelector<HTMLElement>(".print-scroll");
    const logo = document.getElementById("print-logo");
    const prevMax = scroll?.style.maxHeight;
    const prevOvf = scroll?.style.overflow;
    const prevLogo = logo?.style.display;
    try {
      if (scroll) {
        scroll.style.maxHeight = "none";
        scroll.style.overflow = "visible";
      }
      if (logo) logo.style.display = "block";
      const [{ jsPDF }, html2canvas] = await Promise.all([
        import("jspdf"),
        import("html2canvas-pro").then((m) => m.default),
      ]);
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff" });

      const pdf = new jsPDF("p", "pt", "a4");
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW;
      const imgH = (canvas.height * imgW) / canvas.width;
      const imgData = canvas.toDataURL("image/png");
      let heightLeft = imgH;
      let position = 0;
      pdf.addImage(imgData, "PNG", 0, position, imgW, imgH);
      heightLeft -= pageH;
      while (heightLeft > 0) {
        position -= pageH;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgW, imgH);
        heightLeft -= pageH;
      }

      const pdfBase64 = pdf.output("datauristring").split("base64,")[1];
      const nr = p.relativeId ?? p.id;
      const filename = `Projekt-${nr}.pdf`;
      const subject = `Projektübersicht ${p.relativeId != null ? `Nr. ${p.relativeId} ` : ""}${p.name}`;
      const bodyHtml = `<p>Im Anhang die Projektübersicht zu <b>${p.name}</b>${
        p.customerName ? ` (${p.customerName})` : ""
      }.</p>`;

      const b64utf8 = (s: string) => btoa(unescape(encodeURIComponent(s)));
      const wrap = (s: string) => s.replace(/(.{76})/g, "$1\r\n");
      const boundary = `floortec_${Date.now()}`;
      const eml = [
        "To: ",
        `Subject: =?UTF-8?B?${b64utf8(subject)}?=`,
        "X-Unsent: 1",
        "MIME-Version: 1.0",
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        "Content-Type: text/html; charset=utf-8",
        "Content-Transfer-Encoding: base64",
        "",
        wrap(b64utf8(bodyHtml)),
        "",
        `--${boundary}`,
        `Content-Type: application/pdf; name="${filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${filename}"`,
        "",
        wrap(pdfBase64),
        "",
        `--${boundary}--`,
        "",
      ].join("\r\n");

      const blob = new Blob([eml], { type: "message/rfc822" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Projekt-${nr}.eml`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
    } catch (err) {
      console.error(err);
      alert("PDF konnte nicht erzeugt werden.");
    } finally {
      if (scroll) {
        scroll.style.maxHeight = prevMax ?? "";
        scroll.style.overflow = prevOvf ?? "";
      }
      if (logo) logo.style.display = prevLogo ?? "";
      setEmailing(false);
    }
  };

  const moneyData = [
    { name: "Auftrag", value: p.confirmationNet },
    { name: "Rechnungen", value: p.invoiceNet },
    { name: "Offen", value: open },
  ];
  const moneyColors = ["#10b981", "#60a5fa", "#fbbf24"];

  const sollIstData = [
    { name: "Material", Soll: p.calcMaterial, Ist: istMaterialTotal },
    { name: "Lohnkosten", Soll: p.sollLabor, Ist: istLabor },
    { name: "Ertrag", Soll: sollErtrag, Ist: istErtrag },
  ];

  const hoursData = [
    { name: "Kalk.", value: p.calcHours },
    { name: "Ist", value: p.hours },
  ];

  const modal = (
    <div
      id="project-print-overlay"
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        id="project-print-area"
        className="my-6 w-full max-w-4xl rounded-xl border border-gray-300 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Schriftzug – nur im Druck / PDF sichtbar */}
        <div id="print-logo" className="hidden border-b border-gray-200 px-6 py-3 print:block">
          <span className="text-xl font-semibold tracking-[0.2em] text-black">FLOORTEC</span>
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">
              Projekt{p.relativeId != null ? ` · Nr. ${p.relativeId}` : ""}
            </p>
            <h2 className="text-xl font-semibold text-gray-900">{p.name}</h2>
            <p className="mt-0.5 text-sm text-gray-600">
              {p.customerName ?? "—"}
              {p.status ? ` · ${p.status}` : ""}
              {p.confirmationDate ? ` · AB ${dateFmt.format(new Date(p.confirmationDate))}` : ""}
            </p>
          </div>
          <div className="no-print flex shrink-0 flex-wrap items-center gap-2">
            <ProjectPhotosButton projectId={p.id} />
            <ProjectDocumentsButton projectId={p.id} />
            <LogbookButton
              projectId={p.id}
              projectName={p.name}
              projectRelativeId={p.relativeId}
              compact={false}
            />
            <button
              type="button"
              onClick={handlePrint}
              className="rounded-md bg-brand-red px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-red-dark"
            >
              Drucken (A4)
            </button>
            <button
              type="button"
              onClick={emailAsPdf}
              disabled={emailing}
              className="rounded-md border border-brand-red px-3 py-1.5 text-xs font-medium text-brand-red transition-colors hover:bg-brand-red/10 disabled:opacity-60"
            >
              {emailing ? "Erzeuge PDF …" : "Per E-Mail (Outlook)"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-brand-red/50 hover:text-brand-red"
            >
              Schließen
            </button>
          </div>
        </div>

        <div className="print-scroll max-h-[75vh] overflow-y-auto px-6 py-5">
          {/* Kennzahlen */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([
              ["Auftrag (netto)", euro.format(p.confirmationNet)],
              ["Rechnungen (netto)", euro.format(p.invoiceNet)],
              ["Offen", euro.format(open)],
              ...(canFinance
                ? ([
                    ["Ø Lohnsatz", rate > 0 ? `${euro.format(rate)}/h` : "—"],
                    ["Kalk. Material", euro.format(p.calcMaterial)],
                    ["Ist Material", euro.format(p.costNet)],
                    ["Ist Lagerware", euro.format(p.stockNet)],
                  ] as [string, string][])
                : []),
              ["Kalk. Stunden", `${hours.format(p.calcHours)} h`],
              ["Ist Stunden", `${hours.format(p.hours)} h`],
            ] as [string, string][]).map(([label, val]) => (
              <div key={label} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="text-[11px] text-gray-500">{label}</p>
                <p className="mt-0.5 text-sm font-semibold text-gray-900">{val}</p>
              </div>
            ))}
          </div>

          {/* Diagramme */}
          <div className="mt-6 grid grid-cols-1 gap-6 print:grid-cols-3 print:gap-3 lg:grid-cols-3">
            <div className="lg:col-span-1">
              <h3 className="mb-2 text-sm font-medium text-gray-700">Auftrag / Rechnungen</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={moneyData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" stroke="#9ca3af" tick={{ fill: "#374151", fontSize: 11 }} />
                  <YAxis
                    stroke="#9ca3af"
                    tick={{ fill: "#374151", fontSize: 11 }}
                    tickFormatter={(v: number) => euro0.format(v)}
                  />
                  <Tooltip formatter={(v) => euro.format(Number(v))} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {moneyData.map((_, i) => (
                      <Cell key={i} fill={moneyColors[i]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {canFinance && (
            <div className="lg:col-span-1">
              <h3 className="mb-2 text-sm font-medium text-gray-700">Soll / Ist (€)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={sollIstData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" stroke="#9ca3af" tick={{ fill: "#374151", fontSize: 11 }} />
                  <YAxis
                    stroke="#9ca3af"
                    tick={{ fill: "#374151", fontSize: 11 }}
                    tickFormatter={(v: number) => euro0.format(v)}
                  />
                  <Tooltip formatter={(v) => euro.format(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 11, color: "#374151" }} />
                  <Bar dataKey="Soll" fill="#9ca3af" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Ist" fill="#e8392a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            )}

            <div className="lg:col-span-1">
              <h3 className="mb-2 text-sm font-medium text-gray-700">Stunden</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={hoursData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" stroke="#9ca3af" tick={{ fill: "#374151", fontSize: 11 }} />
                  <YAxis stroke="#9ca3af" tick={{ fill: "#374151", fontSize: 11 }} />
                  <Tooltip formatter={(v) => `${hours.format(Number(v))} h`} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    <Cell fill="#9ca3af" />
                    <Cell fill="#e8392a" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Aufschlüsselung */}
          <div className="mt-6">
            <h3 className="mb-1 text-sm font-medium text-gray-700">Aufschlüsselung der Werte</h3>
            <div className="rounded-lg border border-gray-200 px-4 py-1">
              <Calc
                label="Offen"
                formula={`Auftrag ${euro.format(p.confirmationNet)} − Rechnungen ${euro.format(p.invoiceNet)}${
                  p.confirmationNet - p.invoiceNet < 0 ? " (≤ 0 → 0)" : ""
                }`}
                result={euro.format(open)}
              />
              {canFinance && (
                <Calc
                  label="Rest Material"
                  formula={`Kalk. ${euro.format(p.calcMaterial)} − Ist ${euro.format(p.costNet)} − Lager ${euro.format(p.stockNet)}`}
                  result={euro.format(restMaterial)}
                  tone={restMaterial < 0 ? "neg" : "pos"}
                />
              )}
              <Calc
                label="Rest Stunden"
                formula={`Kalk. ${hours.format(p.calcHours)} h − Ist ${hours.format(p.hours)} h`}
                result={`${hours.format(restHours)} h`}
                tone={restHours < 0 ? "neg" : "pos"}
              />
              {canFinance && (
                <>
                  <Calc
                    label="Ø Lohnsatz"
                    formula={`Soll-Lohn ${euro.format(p.sollLabor)} ÷ Kalk. ${hours.format(p.calcHours)} h`}
                    result={rate > 0 ? `${euro.format(rate)}/h` : "—"}
                  />
                  <Calc
                    label="Ist Lohnkosten"
                    formula={`Ist-Stunden ${hours.format(p.hours)} h × Ø ${euro.format(rate)}/h`}
                    result={euro.format(istLabor)}
                  />
                  <Calc
                    label="Soll Ertrag"
                    formula={`Auftrag ${euro.format(p.confirmationNet)} − Kalk. Material ${euro.format(
                      p.calcMaterial
                    )} − Soll-Lohn ${euro.format(p.sollLabor)}`}
                    result={euro.format(sollErtrag)}
                    tone={sollErtrag < 0 ? "neg" : "pos"}
                  />
                  <Calc
                    label="Ist Ertrag"
                    formula={`Rechnungen ${euro.format(p.invoiceNet)} − Ist Material ${euro.format(
                      p.costNet
                    )} − Lager ${euro.format(p.stockNet)} − Ist-Lohn ${euro.format(istLabor)}`}
                    result={euro.format(istErtrag)}
                    tone={istErtrag < 0 ? "neg" : "pos"}
                  />
                </>
              )}
            </div>
          </div>

          {canFinance && (<>
          {/* Arbeitszeiten je Mitarbeiter */}
          <div className="mt-6">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium text-gray-700">Arbeitszeiten je Mitarbeiter</h3>
              {empHours && empHours.length > 0 && (
                <span className="text-xs text-gray-500">
                  Gesamt {hours.format(empHours.reduce((s, e) => s + e.hours, 0))} h
                </span>
              )}
            </div>
            {loadingHours ? (
              <p className="rounded-lg border border-gray-200 px-4 py-3 text-sm text-gray-500">
                Arbeitszeiten werden geladen …
              </p>
            ) : !empHours || empHours.length === 0 ? (
              <p className="rounded-lg border border-gray-200 px-4 py-3 text-sm text-gray-500">
                Keine Arbeitszeiten für dieses Projekt erfasst.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {empHours.map((e) => (
                  <li key={e.name} className="px-4 py-2">
                    <div className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">
                        {e.name}
                      </span>
                      <span className="shrink-0 text-xs text-gray-500">{e.entries} Buchungen</span>
                      <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-gray-900">
                        {hours.format(e.hours)} h
                      </span>
                    </div>
                    <div className="mt-1 ml-1 border-l border-gray-200 pl-3">
                      {e.days.map((d) => (
                        <div
                          key={d.date}
                          className="flex items-center justify-between gap-3 py-0.5 text-xs text-gray-600"
                        >
                          <span>{dateFmt.format(new Date(d.date))}</span>
                          <span className="tabular-nums">{hours.format(d.hours)} h</span>
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
                <li className="flex items-center gap-3 border-t border-gray-200 bg-gray-50 px-4 py-2">
                  <span className="flex-1 text-sm font-semibold text-gray-900">Summe</span>
                  <span className="w-24 text-right text-sm font-semibold tabular-nums text-gray-900">
                    {hours.format(empHours.reduce((s, e) => s + e.hours, 0))} h
                  </span>
                </li>
              </ul>
            )}
          </div>

          {/* Belege */}
          <div className="mt-6">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium text-gray-700">Belege</h3>
              {receipts && receipts.length > 0 && (
                <span className="text-xs text-gray-500">
                  {receipts.length} · Netto {euro.format(receipts.reduce((s, r) => s + r.net, 0))}
                </span>
              )}
            </div>
            {loadingReceipts ? (
              <p className="rounded-lg border border-gray-200 px-4 py-3 text-sm text-gray-500">
                Belege werden geladen …
              </p>
            ) : !receipts || receipts.length === 0 ? (
              <p className="rounded-lg border border-gray-200 px-4 py-3 text-sm text-gray-500">
                Keine Belege diesem Projekt zugeordnet.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {receipts.map((r) => {
                  const content = (
                    <>
                      <span className="w-24 shrink-0 text-xs text-gray-500">
                        {r.date ? dateFmt.format(new Date(r.date)) : "—"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">
                        {r.number}
                        {r.filename && (
                          <span className="ml-2 truncate text-xs font-normal text-gray-500">
                            {r.filename}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-right text-sm tabular-nums text-gray-700">
                        {euro.format(r.net)}
                      </span>
                      <span className="w-5 shrink-0 text-right text-gray-400">
                        {r.docUrl ? "↗" : ""}
                      </span>
                    </>
                  );
                  return (
                    <li key={r.id}>
                      {r.docUrl ? (
                        <a
                          href={r.docUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-gray-50"
                          title="PDF in neuem Tab öffnen"
                        >
                          {content}
                        </a>
                      ) : (
                        <div className="flex items-center gap-3 px-4 py-2.5 text-gray-400">
                          {content}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          </>)}

          {/* Material: Soll (Kalkulation) und Ist (gebuchte Ware) je Artikel nebeneinander */}
          <div className="mt-6">
            {(() => {
              // Ist = Lagerbuchungen + per OCR aus den zugeordneten Belegen gelesene Artikel.
              const istItems: IstItem[] = [
                ...(bookedMat?.items ?? []).map((it) => ({
                  name: it.materialName,
                  unit: it.unit,
                  quantity: it.quantity,
                  value: it.value,
                  source: "lager" as const,
                })),
                ...(belegMat?.items ?? []).map((it) => ({
                  name: it.name,
                  unit: it.unit,
                  quantity: it.quantity,
                  value: it.value,
                  source: "beleg" as const,
                })),
              ];
              const rows = mergeMaterials(calcMat, istItems, manualMap);
              const sollRows = rows.filter((r) => r.sollEk > 0 || r.sollQty > 0);
              const hasUnmatched = rows.some(
                (r) => r.sollEk === 0 && r.sollQty === 0 && (r.istValue !== 0 || r.istQty !== 0)
              );
              // Tabelle nicht auf das (langsamere) Beleg-OCR warten lassen.
              const loading = loadingCalcMat || loadingBookedMat;
              const sollTotal = calcMat?.materialTotal ?? 0;
              const istTotal = (bookedMat?.total ?? 0) + (belegMat?.total ?? 0);
              return (
                <>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <h3 className="text-sm font-medium text-gray-700">Material · Soll / Ist je Artikel</h3>
                    <div className="flex items-baseline gap-3 text-xs text-gray-500">
                      {loadingBelegMat && <span className="text-gray-400">Belege werden ausgelesen …</span>}
                      {rows.length > 0 && (
                        <span>
                          {rows.length} Artikel
                          {canFinance ? ` · Soll ${euro.format(sollTotal)} · Ist ${euro.format(istTotal)}` : ""}
                        </span>
                      )}
                      {canFinance && (
                        <button
                          type="button"
                          onClick={resetAssignment}
                          disabled={resetting}
                          title="Komplette Zuordnung löschen und Belege neu auslesen"
                          className="rounded border border-gray-300 px-2 py-0.5 font-medium text-gray-600 transition-colors hover:border-brand-red/50 hover:text-brand-red disabled:opacity-50"
                        >
                          {resetting ? "Setze zurück …" : "Zuordnung zurücksetzen"}
                        </button>
                      )}
                    </div>
                  </div>
                  {hasUnmatched && sollRows.length > 0 && (
                    <p className="mb-1 text-xs text-gray-400">
                      Tipp: Nicht zugeordnete Ist-Artikel (unten, gestrichelt) per Drag &amp; Drop auf
                      den passenden Soll-Artikel ziehen – die Zuordnung wird gespeichert.
                    </p>
                  )}
                  {loading ? (
                    <p className="rounded-lg border border-gray-200 px-4 py-3 text-sm text-gray-500">
                      Material wird geladen …
                    </p>
                  ) : rows.length === 0 ? (
                    <p className="rounded-lg border border-gray-200 px-4 py-3 text-sm text-gray-500">
                      {loadingBelegMat
                        ? "Belege werden ausgelesen …"
                        : "Kein kalkuliertes oder gebuchtes Material gefunden."}
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                      <table className="w-full min-w-[560px] text-left text-sm">
                        <thead>
                          <tr className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                            <th rowSpan={2} className="px-3 py-2 align-bottom font-medium">Material</th>
                            <th colSpan={canFinance ? 2 : 1} className="border-l border-gray-200 px-3 py-1.5 text-center font-medium">
                              Soll (Kalkulation)
                            </th>
                            <th colSpan={canFinance ? 2 : 1} className="border-l border-gray-200 px-3 py-1.5 text-center font-medium">
                              Ist (Lager + Belege)
                            </th>
                          </tr>
                          <tr className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                            <th className="border-l border-gray-200 px-3 py-1.5 text-right font-medium">Menge</th>
                            {canFinance && <th className="px-3 py-1.5 text-right font-medium">EK</th>}
                            <th className="border-l border-gray-200 px-3 py-1.5 text-right font-medium">Menge</th>
                            {canFinance && <th className="px-3 py-1.5 text-right font-medium">EK</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, i) => {
                            const isSoll = r.sollEk > 0 || r.sollQty > 0;
                            const isIstOnly = !isSoll && (r.istValue !== 0 || r.istQty !== 0);
                            const isDropTarget = dropTarget === r.name && dragName != null && isSoll;
                            return (
                              <tr
                                key={i}
                                draggable={isIstOnly}
                                onDragStart={
                                  isIstOnly
                                    ? (e) => {
                                        setDragName(r.name);
                                        e.dataTransfer.effectAllowed = "move";
                                      }
                                    : undefined
                                }
                                onDragEnd={isIstOnly ? () => { setDragName(null); setDropTarget(null); } : undefined}
                                onDragOver={
                                  isSoll && dragName
                                    ? (e) => { e.preventDefault(); setDropTarget(r.name); }
                                    : undefined
                                }
                                onDragLeave={isSoll ? () => setDropTarget((t) => (t === r.name ? null : t)) : undefined}
                                onDrop={
                                  isSoll && dragName
                                    ? (e) => {
                                        e.preventDefault();
                                        assignMapping(dragName, r.name);
                                        setDragName(null);
                                        setDropTarget(null);
                                      }
                                    : undefined
                                }
                                className={`border-b border-gray-100 last:border-0 ${
                                  isIstOnly ? "cursor-grab border-dashed bg-amber-50/40" : ""
                                } ${isDropTarget ? "ring-2 ring-inset ring-brand-red/60" : ""}`}
                              >
                                <td className="px-3 py-2 text-gray-800">
                                  <span className="flex items-center gap-1.5">
                                    {isIstOnly && <span className="text-gray-300" aria-hidden>⠿</span>}
                                    <span>{r.name}</span>
                                    {isIstOnly && r.belegNames.includes(r.name) && (
                                      <button
                                        type="button"
                                        onClick={() => excludeBeleg(r.name)}
                                        title="Beleg-Artikel entfernen"
                                        className="text-gray-300 transition-colors hover:text-brand-red"
                                      >
                                        🗑
                                      </button>
                                    )}
                                  </span>
                                  {r.istAltNames.map((alt) => (
                                    <span key={alt} className="mt-0.5 flex items-center gap-1 text-xs text-gray-400">
                                      ≈ {alt}
                                      {r.belegNames.includes(alt) && (
                                        <button
                                          type="button"
                                          onClick={() => excludeBeleg(alt)}
                                          title="Beleg-Artikel entfernen"
                                          className="text-gray-300 transition-colors hover:text-brand-red"
                                        >
                                          🗑
                                        </button>
                                      )}
                                    </span>
                                  ))}
                                  {r.manualAltNames.map((alt) => (
                                    <span key={alt} className="mt-0.5 flex items-center gap-1 text-xs text-emerald-600">
                                      ↳ {alt}
                                      <button
                                        type="button"
                                        onClick={() => unassignMapping(alt)}
                                        title="Zuordnung lösen"
                                        className="text-gray-300 transition-colors hover:text-brand-red"
                                      >
                                        ✕
                                      </button>
                                      {r.belegNames.includes(alt) && (
                                        <button
                                          type="button"
                                          onClick={() => excludeBeleg(alt)}
                                          title="Beleg-Artikel entfernen"
                                          className="text-gray-300 transition-colors hover:text-brand-red"
                                        >
                                          🗑
                                        </button>
                                      )}
                                    </span>
                                  ))}
                                </td>
                                <td className="border-l border-gray-100 px-3 py-2 text-right tabular-nums text-gray-600">
                                  {r.sollQty ? `${hours.format(r.sollQty)}${r.unit ? ` ${r.unit}` : ""}` : "—"}
                                </td>
                                {canFinance && (
                                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                                    {r.sollEk ? euro.format(r.sollEk) : "—"}
                                  </td>
                                )}
                                <td className="border-l border-gray-100 px-3 py-2 text-right tabular-nums text-gray-600">
                                  {r.istQty ? `${hours.format(r.istQty)}${r.unit ? ` ${r.unit}` : ""}` : "—"}
                                </td>
                                {canFinance && (
                                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                                    {r.istValue ? euro.format(r.istValue) : "—"}
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                        {canFinance && (
                          <tfoot>
                            <tr className="border-t border-gray-200 bg-gray-50 font-semibold text-gray-900">
                              <td className="px-3 py-2 text-sm">Summe EK</td>
                              <td className="border-l border-gray-200 px-3 py-2" />
                              <td className="px-3 py-2 text-right text-sm tabular-nums">{euro.format(sollTotal)}</td>
                              <td className="border-l border-gray-200 px-3 py-2" />
                              <td className="px-3 py-2 text-right text-sm tabular-nums">{euro.format(istTotal)}</td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  )}
                  {belegMat && belegMat.excluded.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                      <span className="text-gray-400">Entfernte Beleg-Artikel:</span>
                      {belegMat.excluded.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => restoreBeleg(name)}
                          title="Wiederherstellen"
                          className="rounded border border-gray-300 px-1.5 py-0.5 text-gray-500 line-through transition-colors hover:border-emerald-500/50 hover:text-emerald-600 hover:no-underline"
                        >
                          {name} ↺
                        </button>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>

        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
