"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveMonthlyFieldAction,
  uploadKrankmeldungAction,
  deleteKrankmeldungAction,
} from "@/app/dashboard/arbeitszeiten/overview-actions";
import type { MonthlyOverviewRow, MonthlyField } from "@/lib/monthly-overview";

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
  const fileInputs = useRef<Record<number, HTMLInputElement | null>>({});

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
        <p className="text-sm text-gray-600">{rows.length} Mitarbeiter</p>
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
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.employeeId} className="even:bg-gray-50">
                  <td className="border border-gray-300 px-3 py-1.5 font-medium text-gray-900">
                    {row.name}
                  </td>
                  {FIELDS.map((f) => {
                    const original = String(row[f.prop] ?? "");
                    const k = cellKey(row.employeeId, f.key);
                    return (
                      <td key={f.key} className="border border-gray-300 p-0">
                        <input
                          value={draft[k] ?? original}
                          onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                          onBlur={(e) => saveField(row.employeeId, f.key, e.target.value, original)}
                          className="w-full min-w-[7rem] bg-transparent px-3 py-1.5 text-sm text-gray-900 outline-none focus:bg-brand-red/5"
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
