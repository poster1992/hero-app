"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveFixkostenSnapshotAction, setFixkostenOverrideAction } from "@/app/dashboard/fixkosten/actions";
import type { FixkostenHistory } from "@/lib/fixkosten";

const MONTH_LABELS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

function fmtEur(n: number): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

/** Zelle für einen projizierten Zukunftsmonat: Klick öffnet ein Eingabefeld für eine manuelle Übersteuerung. */
function ProjectedCell({
  name,
  year,
  month,
  value,
  isOverride,
}: {
  name: string;
  year: number;
  month: number;
  value: number | null;
  isOverride: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value != null ? String(value).replace(".", ",") : "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await setFixkostenOverrideAction(name, year, month, draft);
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
      const res = await setFixkostenOverrideAction(name, year, month, "");
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
      <td className="whitespace-nowrap bg-sky-50 px-1 py-1">
        <div className="flex items-center justify-end gap-1">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            inputMode="decimal"
            className="w-20 rounded border border-gray-300 px-1 py-1 text-right text-xs outline-none focus:border-brand-red/60"
          />
          <button type="button" onClick={save} disabled={pending} title="Speichern" className="text-emerald-600 hover:text-emerald-800">
            ✓
          </button>
          {isOverride && (
            <button type="button" onClick={clear} disabled={pending} title="Zurück zur Prognose" className="text-gray-400 hover:text-rose-600">
              ↺
            </button>
          )}
        </div>
        {error && <div className="text-left text-rose-600">{error}</div>}
      </td>
    );
  }

  return (
    <td
      onClick={() => setEditing(true)}
      title={isOverride ? "Manuell eingetragen – klicken zum Ändern" : "Prognose – klicken, um manuell einzutragen"}
      className={`whitespace-nowrap px-2 py-2 italic cursor-pointer hover:bg-sky-50 ${
        isOverride ? "font-semibold not-italic text-sky-700" : "text-gray-400"
      }`}
    >
      {value == null ? "–" : fmtEur(value)}
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
          Prognose auf Basis des aktuellen Stands – anklicken, um dort einen eigenen Wert einzutragen (z. B. wenn ein
          Mitarbeiter gekündigt hat).
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
                {MONTH_LABELS.map((m, i) => (
                  <th
                    key={m}
                    className={`px-2 py-2 font-medium ${i === currentMonthIdx ? "text-gray-900" : ""} ${
                      history.months[i]?.isProjected ? "italic text-sky-600" : history.months[i]?.hasSnapshot ? "" : "text-gray-300"
                    }`}
                  >
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.rows.map((row) => (
                <tr key={row.name} className="border-b border-gray-100">
                  <td className="whitespace-nowrap px-2 py-2 text-left text-gray-500">{row.accountNumber ?? "—"}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-left font-medium text-gray-900">{row.name}</td>
                  {row.monthly.map((v, i) =>
                    history.months[i]?.isProjected ? (
                      <ProjectedCell
                        key={i}
                        name={row.name}
                        year={year}
                        month={i + 1}
                        value={v}
                        isOverride={row.overrideFlags[i]}
                      />
                    ) : (
                      <td key={i} className="whitespace-nowrap px-2 py-2 text-gray-700">
                        {v == null ? "–" : fmtEur(v)}
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
                {history.totalMonthly.map((v, i) => (
                  <td
                    key={i}
                    className={`whitespace-nowrap px-2 py-2 ${history.months[i]?.isProjected ? "italic text-sky-700" : ""}`}
                  >
                    {history.months[i]?.hasSnapshot || history.months[i]?.isProjected ? fmtEur(v) : "–"}
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
