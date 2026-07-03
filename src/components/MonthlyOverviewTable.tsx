"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveMonthlyFieldAction,
  uploadKrankmeldungAction,
  deleteKrankmeldungAction,
  setDocsCompleteAction,
} from "@/app/dashboard/arbeitszeiten/overview-actions";
import type { MonthlyOverviewRow, MonthlyField } from "@/lib/monthly-overview";

/** Editierbare Zelle mit automatischem Zeilenumbruch (Textarea wächst mit). */
function AutoCell({
  value,
  onChange,
  onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(resize, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onBlur(e.target.value)}
      onInput={resize}
      className="block w-full min-w-[7rem] resize-none overflow-hidden whitespace-pre-wrap break-words bg-transparent px-3 py-1.5 text-sm leading-snug text-gray-900 outline-none focus:bg-brand-red/5"
    />
  );
}

const FIELDS: { key: MonthlyField; label: string; prop: keyof MonthlyOverviewRow }[] = [
  { key: "krank", label: "Krank", prop: "krank" },
  { key: "krank_gesamt", label: "Krank gesamt", prop: "krankGesamt" },
  { key: "urlaub", label: "Urlaub", prop: "urlaub" },
  { key: "urlaub_gesamt", label: "Urlaub gesamt", prop: "urlaubGesamt" },
  { key: "ueberstunden", label: "Überstunden mit 40% Aufschlag", prop: "ueberstunden" },
  { key: "elternzeit", label: "Elternzeit/Sonderurlaub", prop: "elternzeit" },
];

export default function MonthlyOverviewTable({
  rows,
  year,
  month,
  periodLabel,
}: {
  rows: MonthlyOverviewRow[];
  year: number;
  month: number;
  periodLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Lokale Entwürfe je Zelle (damit die Eingabe beim Speichern nicht zurückspringt).
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [completeOverride, setCompleteOverride] = useState<Record<number, boolean>>({});
  const fileInputs = useRef<Record<number, HTMLInputElement | null>>({});

  // Beim Monats-/Jahreswechsel lokale (optimistische) Zustände leeren, damit jeder
  // Monat seinen eigenen Status/seine eigenen Werte aus den Serverdaten zeigt.
  useEffect(() => {
    setDraft({});
    setCompleteOverride({});
  }, [year, month]);

  const toggleComplete = (employeeId: number, current: boolean) => {
    const next = !current;
    setCompleteOverride((m) => ({ ...m, [employeeId]: next }));
    startTransition(async () => {
      await setDocsCompleteAction(year, month, employeeId, next);
      router.refresh();
    });
  };

  // PDF-Formular (hell) direkt erzeugen und herunterladen.
  const exportPdf = async () => {
    setBusy("pdf");
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const marginX = 12;
      const usable = 297 - marginX * 2;
      const cols = [
        { label: "Mitarbeiter", w: 42, prop: "name" as const },
        { label: "Krank", w: 30, prop: "krank" as const },
        { label: "Krank gesamt", w: 37, prop: "krankGesamt" as const },
        { label: "Urlaub", w: 30, prop: "urlaub" as const },
        { label: "Urlaub gesamt", w: 37, prop: "urlaubGesamt" as const },
        { label: "Überstunden mit 40% Aufschlag", w: 49, prop: "ueberstunden" as const },
        { label: "Elternzeit/Sonderurlaub", w: usable - 42 - 30 - 37 - 30 - 37 - 49, prop: "elternzeit" as const },
      ];
      let y = 16;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text(`Monatliche Übersicht ${periodLabel}`, marginX, y);
      y += 6;

      const rowH = 9;
      const headerFont = 7.5;
      const headerLineH = 3.3;
      // Kopfhöhe nach dem am stärksten umbrochenen Label bemessen.
      doc.setFont("helvetica", "bold");
      doc.setFontSize(headerFont);
      const headerLines = cols.map((c) => doc.splitTextToSize(c.label, c.w - 3) as string[]);
      const maxLines = Math.max(...headerLines.map((l) => l.length));
      const headerH = maxLines * headerLineH + 3;
      const drawHeader = () => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(headerFont);
        let x = marginX;
        cols.forEach((c, i) => {
          // Füllung und Rahmen getrennt zeichnen (browserseitig ist "FD" unzuverlässig
          // und kann eine schwarze Fläche erzeugen). So bleibt der Kopf immer hell.
          doc.setFillColor(235, 235, 235);
          doc.rect(x, y, c.w, headerH, "F");
          doc.setDrawColor(150, 150, 150);
          doc.rect(x, y, c.w, headerH, "S");
          doc.setTextColor(0, 0, 0);
          doc.text(headerLines[i], x + 1.5, y + 3.2);
          x += c.w;
        });
        y += headerH;
      };
      drawHeader();

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      for (const row of rows) {
        if (y + rowH > 205) {
          doc.addPage();
          y = 16;
          drawHeader();
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
        }
        let x = marginX;
        for (const c of cols) {
          doc.setDrawColor(180, 180, 180);
          doc.rect(x, y, c.w, rowH);
          const text = String(row[c.prop] ?? "");
          if (text) {
            doc.setTextColor(20, 20, 20);
            doc.text(doc.splitTextToSize(text, c.w - 3), x + 1.5, y + 5.5);
          }
          x += c.w;
        }
        y += rowH;
      }
      doc.save(`Monatliche-Uebersicht-${periodLabel.replace(/\s+/g, "-")}.pdf`);
    } finally {
      setBusy(null);
    }
  };

  // Alle Krankmeldungen des Monats als ZIP (jede Datei separat) herunterladen.
  const exportAttachments = async () => {
    const files = rows.flatMap((r) =>
      r.krankmeldungen.map((f) => ({ ...f, employee: r.name }))
    );
    if (files.length === 0) {
      alert("Keine Krankmeldungen in diesem Monat vorhanden.");
      return;
    }
    setBusy("zip");
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const used = new Set<string>();
      for (const f of files) {
        try {
          const res = await fetch(`/api/krankmeldung?id=${f.id}`);
          if (!res.ok) continue;
          const blob = await res.blob();
          const safeEmp = f.employee.replace(/[^\wäöüÄÖÜß .-]/g, "_").slice(0, 40);
          let name = `${safeEmp}_${f.fileName}`.replace(/\s+/g, " ").trim();
          let i = 2;
          const base = name.replace(/(\.[a-z0-9]+)?$/i, "");
          const ext = name.slice(base.length);
          while (used.has(name)) name = `${base} (${i++})${ext}`;
          used.add(name);
          zip.file(name, blob);
        } catch {
          // einzelne Datei überspringen
        }
      }
      const out = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Krankmeldungen-${periodLabel.replace(/\s+/g, "-")}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(null);
    }
  };

  const cellKey = (employeeId: number, field: MonthlyField) => `${employeeId}:${field}`;

  const saveField = (employeeId: number, field: MonthlyField, value: string, original: string) => {
    if (value === original) return;
    startTransition(async () => {
      await saveMonthlyFieldAction(year, month, employeeId, field, value);
      router.refresh();
    });
  };

  const upload = (employeeId: number, file: File) => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("year", String(year));
      fd.set("month", String(month));
      fd.set("employeeId", String(employeeId));
      fd.set("file", file);
      await uploadKrankmeldungAction(fd);
      router.refresh();
    });
  };

  const removeFile = (id: number) => {
    startTransition(async () => {
      await deleteKrankmeldungAction(id);
      router.refresh();
    });
  };

  return (
    <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
        <h2 className="text-lg font-semibold text-gray-900">Monatliche Übersicht {periodLabel}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-600">{rows.length} Mitarbeiter</span>
          <button
            type="button"
            onClick={exportPdf}
            disabled={busy !== null}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-brand-red/50 hover:text-gray-900 disabled:opacity-50"
          >
            {busy === "pdf" ? "PDF …" : "Als PDF"}
          </button>
          <button
            type="button"
            onClick={exportAttachments}
            disabled={busy !== null}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-brand-red/50 hover:text-gray-900 disabled:opacity-50"
          >
            {busy === "zip" ? "ZIP …" : "Anhänge (ZIP)"}
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-gray-500">
          Keine aktiven Mitarbeiter in der Abschlagsliste. Unter „Lohn Abschläge erstellen"
          Mitarbeiter anlegen.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-gray-100">
              <tr className="text-left text-xs font-semibold text-gray-700">
                <th className="border border-gray-300 px-3 py-2">Mitarbeiter</th>
                {FIELDS.map((f) => (
                  <th key={f.key} className="border border-gray-300 px-3 py-2">
                    {f.label}
                  </th>
                ))}
                <th className="border border-gray-300 px-3 py-2">Krankmeldung</th>
                <th className="border border-gray-300 px-3 py-2">Unterlagen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.employeeId} className="even:bg-white/[0.04]">
                  <td className="border border-gray-300 px-3 py-1.5 font-medium text-gray-900">
                    {row.name}
                  </td>
                  {FIELDS.map((f) => {
                    const original = String(row[f.prop] ?? "");
                    const k = cellKey(row.employeeId, f.key);
                    return (
                      <td key={f.key} className="border border-gray-300 p-0 align-top">
                        <AutoCell
                          value={draft[k] ?? original}
                          onChange={(v) => setDraft((d) => ({ ...d, [k]: v }))}
                          onBlur={(v) => saveField(row.employeeId, f.key, v, original)}
                        />
                      </td>
                    );
                  })}
                  <td className="border border-gray-300 px-3 py-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {row.krankmeldungen.map((file) => (
                        <span
                          key={file.id}
                          className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs"
                        >
                          <a
                            href={`/api/krankmeldung?id=${file.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={file.fileName}
                            className="max-w-[9rem] truncate text-brand-red hover:underline"
                          >
                            {file.fileName}
                          </a>
                          <button
                            type="button"
                            onClick={() => removeFile(file.id)}
                            disabled={pending}
                            className="text-gray-400 hover:text-brand-red"
                            title="Entfernen"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                      <input
                        ref={(el) => {
                          fileInputs.current[row.employeeId] = el;
                        }}
                        type="file"
                        accept="application/pdf,image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) upload(row.employeeId, file);
                          e.target.value = "";
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputs.current[row.employeeId]?.click()}
                        disabled={pending}
                        className="rounded-md border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 hover:border-brand-red/50 hover:text-gray-900 disabled:opacity-50"
                      >
                        + Datei
                      </button>
                    </div>
                  </td>
                  <td className="border border-gray-300 px-3 py-1.5">
                    {(() => {
                      const isComplete = completeOverride[row.employeeId] ?? row.docsComplete;
                      return (
                        <button
                          type="button"
                          onClick={() => toggleComplete(row.employeeId, isComplete)}
                          disabled={pending}
                          className={`w-full rounded-md px-2 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 ${
                            isComplete ? "bg-emerald-600" : "bg-brand-red"
                          }`}
                          title="Status umschalten"
                        >
                          {isComplete ? "Unterlagen vollständig" : "Unterlagen unvollständig"}
                        </button>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
