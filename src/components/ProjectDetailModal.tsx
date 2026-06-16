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
  type ProjectReceiptItem,
  type ProjectEmployeeHours,
} from "@/app/dashboard/projekte/receipts-actions";

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

export default function ProjectDetailModal({
  project,
  onClose,
}: {
  project: ProjectRow | null;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [receipts, setReceipts] = useState<ProjectReceiptItem[] | null>(null);
  const [loadingReceipts, setLoadingReceipts] = useState(false);
  const [empHours, setEmpHours] = useState<ProjectEmployeeHours[] | null>(null);
  const [loadingHours, setLoadingHours] = useState(false);
  const [emailing, setEmailing] = useState(false);

  useEffect(() => {
    if (!project) {
      setReceipts(null);
      setEmpHours(null);
      return;
    }
    let cancelled = false;
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
    return () => {
      cancelled = true;
    };
  }, [project]);

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
  const restMaterial = p.calcMaterial - p.costNet;
  const restHours = p.calcHours - p.hours;
  const rate = p.calcHours > 0 ? p.sollLabor / p.calcHours : 0;
  const istLabor = p.hours * rate;
  const sollErtrag = p.confirmationNet - p.calcMaterial - p.sollLabor;
  const istErtrag = p.invoiceNet - p.costNet - istLabor;

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
    { name: "Material", Soll: p.calcMaterial, Ist: p.costNet },
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
        {/* Logo – nur im Druck / PDF sichtbar */}
        <div id="print-logo" className="hidden border-b border-gray-200 px-6 py-3 print:block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="FLOORTEC.design" className="h-12 w-auto" />
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
          <div className="no-print flex shrink-0 items-center gap-2">
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
            {[
              ["Auftrag (netto)", euro.format(p.confirmationNet)],
              ["Rechnungen (netto)", euro.format(p.invoiceNet)],
              ["Offen", euro.format(open)],
              ["Ø Lohnsatz", rate > 0 ? `${euro.format(rate)}/h` : "—"],
              ["Kalk. Material", euro.format(p.calcMaterial)],
              ["Ist Material", euro.format(p.costNet)],
              ["Kalk. Stunden", `${hours.format(p.calcHours)} h`],
              ["Ist Stunden", `${hours.format(p.hours)} h`],
            ].map(([label, val]) => (
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
              <Calc
                label="Rest Material"
                formula={`Kalk. ${euro.format(p.calcMaterial)} − Ist ${euro.format(p.costNet)}`}
                result={euro.format(restMaterial)}
                tone={restMaterial < 0 ? "neg" : "pos"}
              />
              <Calc
                label="Rest Stunden"
                formula={`Kalk. ${hours.format(p.calcHours)} h − Ist ${hours.format(p.hours)} h`}
                result={`${hours.format(restHours)} h`}
                tone={restHours < 0 ? "neg" : "pos"}
              />
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
                )} − Ist-Lohn ${euro.format(istLabor)}`}
                result={euro.format(istErtrag)}
                tone={istErtrag < 0 ? "neg" : "pos"}
              />
            </div>
          </div>

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
                        {euro.format(r.gross)}
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

        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
