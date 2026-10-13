"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveFixkostenSnapshotAction, setFixkostenOverrideAction } from "@/app/dashboard/fixkosten/actions";
import type { FixkostenHistory } from "@/lib/fixkosten";

const MONTH_LABELS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

function fmtEur(n: number): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

/**
 * Zelle für einen projizierten Zukunftsmonat: Klick öffnet Eingabefelder für
 * eine manuelle Übersteuerung des Betrags UND/ODER eine Notiz (z. B. eine
 * Begründung), unabhängig voneinander setzbar.
 */
function ProjectedCell({
  name,
  year,
  month,
  value,
  isOverride,
  note,
}: {
  name: string;
  year: number;
  month: number;
  value: number | null;
  isOverride: boolean;
  note: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draftAmount, setDraftAmount] = useState(value != null ? String(value).replace(".", ",") : "");
  const [draftNote, setDraftNote] = useState(note ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await setFixkostenOverrideAction(name, year, month, draftAmount, draftNote);
      if (!res.ok) {
        setError(res.error ?? "Fehler");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  const clear = () => {
    setError(null);
    startTransition(async () => {
      const res = await setFixkostenOverrideAction(name, year, month, "", "");
      if (!res.ok) {
        setError(res.error ?? "Fehler");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  if (editing) {
    return (
      <td className="relative bg-sky-50 px-2 py-2">
        <div className="absolute right-0 top-0 z-20 flex w-64 flex-col gap-1.5 rounded-md border border-gray-200 bg-white p-2 shadow-lg">
          <input
            autoFocus
            value={draftAmount}
            onChange={(e) => setDraftAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
            }}
            inputMode="decimal"
            placeholder="Betrag (Prognose, falls leer)"
            className="w-full rounded border border-gray-300 px-1.5 py-1 text-right text-xs outline-none focus:border-brand-red/60"
          />
          <textarea
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
            }}
            rows={4}
            placeholder="Notiz (z. B. Kündigung MA XY zum 31.12.)"
            className="w-full resize-y rounded border border-gray-300 px-1.5 py-1 text-left text-xs outline-none focus:border-brand-red/60"
          />
          <div className="flex items-center gap-1.5">
            {(isOverride || note) && (
              <button
                type="button"
                onClick={clear}
                disabled={pending}
                title="Übersteuerung + Notiz entfernen"
                className="text-xs text-gray-400 hover:text-rose-600"
              >
                ↺ zurücksetzen
              </button>
            )}
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="ml-auto rounded bg-brand-red px-2 py-0.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              Speichern
            </button>
          </div>
          {error && <div className="text-left text-xs text-rose-600">{error}</div>}
        </div>
      </td>
    );
  }

  return (
    <td onClick={() => setEditing(true)} className="group relative cursor-pointer px-2 py-2 hover:bg-sky-50">
      <div
        className={`flex items-center justify-end gap-1 whitespace-nowrap ${
          isOverride ? "font-semibold not-italic text-sky-700" : "italic text-gray-400"
        }`}
      >
        {note && <span className="text-sky-500">📝</span>}
        <span>{value == null ? "–" : fmtEur(value)}</span>
      </div>
      {note && (
        <div className="pointer-events-none absolute right-0 top-full z-30 mt-1 hidden w-64 whitespace-pre-line rounded-md border border-gray-200 bg-white p-2 text-left text-xs font-normal normal-case text-gray-700 shadow-lg group-hover:block">
          {note}
        </div>
      )}
    </td>
  );
}

export default function FixkostenHistoryTable({ history, year }: { history: FixkostenHistory; year: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const now = new Date();
  const currentMonthIdx = now.getUTCFullYear() === year ? now.getUTCMonth() : -1;
  // Nur Monate mit echtem Stand oder Zukunftsprognose anzeigen – leere Lücken
  // (z. B. Monate vor Nutzung der App) blenden wir aus statt leerer Spalten.
  const visibleMonths = history.months
    .map((m, i) => ({ ...m, idx: i }))
    .filter((m) => m.hasSnapshot || m.isProjected);

  const save = () => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveFixkostenSnapshotAction();
      if (!res.ok) {
        setError(res.error ?? "Fehler beim Sichern");
        return;
      }
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <div className="border border-line bg-white p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600">
          Zeigt, wie sich die monatlichen Fixkosten je Position über das Jahr {year} entwickelt haben – je Monat der
          zuletzt gesicherte Stand (wird automatisch einmal im Monat gesichert, kann aber jederzeit manuell
          aktualisiert werden). <span className="italic text-gray-400">Kursive</span> Zukunftsmonate sind eine
          Prognose auf Basis des aktuellen Stands – anklicken, um dort einen eigenen Wert und/oder eine Notiz
          einzutragen (z. B. wenn ein Mitarbeiter gekündigt hat).
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="shrink-0 rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Sichert …" : "📌 Stand sichern"}
          </button>
          {saved && !error && <span className="text-xs text-emerald-700">Gespeichert ✓</span>}
          {error && <span className="text-xs text-rose-600">{error}</span>}
        </div>
      </div>

      {history.rows.length === 0 ? (
        <p className="text-sm text-gray-500">
          Noch kein Stand für {year} gesichert. Klicke auf „Stand sichern&quot;, um den aktuellen Stand als ersten
          Verlaufspunkt zu speichern.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-gray-300 text-xs uppercase tracking-wide text-gray-500">
                <th className="px-2 py-2 text-left font-medium">Konto</th>
                <th className="px-2 py-2 text-left font-medium">Position</th>
                {visibleMonths.map((m) => (
                  <th
                    key={m.idx}
                    className={`px-2 py-2 font-medium ${m.idx === currentMonthIdx ? "text-gray-900" : ""} ${
                      m.isProjected ? "italic text-sky-600" : ""
                    }`}
                  >
                    {MONTH_LABELS[m.idx]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.rows.map((row) => (
                <tr key={row.name} className="border-b border-gray-100">
                  <td className="whitespace-nowrap px-2 py-2 text-left text-gray-500">{row.accountNumber ?? "—"}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-left font-medium text-gray-900">{row.name}</td>
                  {visibleMonths.map((m) =>
                    m.isProjected ? (
                      <ProjectedCell
                        key={m.idx}
                        name={row.name}
                        year={year}
                        month={m.idx + 1}
                        value={row.monthly[m.idx]}
                        isOverride={row.overrideFlags[m.idx]}
                        note={row.notes[m.idx]}
                      />
                    ) : (
                      <td key={m.idx} className="whitespace-nowrap px-2 py-2 text-gray-700">
                        {row.monthly[m.idx] == null ? "–" : fmtEur(row.monthly[m.idx]!)}
                      </td>
                    )
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 font-semibold text-gray-900">
                <td colSpan={2} className="whitespace-nowrap px-2 py-2 text-left">
                  Gesamt Fixkosten
                </td>
                {visibleMonths.map((m) => (
                  <td key={m.idx} className={`whitespace-nowrap px-2 py-2 ${m.isProjected ? "italic text-sky-700" : ""}`}>
                    {fmtEur(history.totalMonthly[m.idx])}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
