"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import {
  saveDailyReportConfigAction,
  sendTestDailyReportAction,
  type SettingsState,
} from "@/app/dashboard/einstellungen/actions";

export interface DailyReportUiConfig {
  enabled: boolean;
  hour: number;
  sendWhenEmpty: boolean;
  recipients: string;
  overrunThreshold: number;
  checks: { hours: boolean; nocalc: boolean; logbook: boolean; missing: boolean };
  logbookKeywords: string;
  instructions: string;
  lastSent: string | null;
}

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60";

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      {subtitle && <p className="mt-1 mb-4 text-sm text-gray-600">{subtitle}</p>}
      {children}
    </div>
  );
}

/** Der Tagesbericht-Agent mit voller Regelsteuerung. */
function DailyReportCard({ cfg }: { cfg: DailyReportUiConfig }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveDailyReportConfigAction, {});
  const [testing, startTest] = useTransition();
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <Card
      title="📊 Tagesbericht"
      subtitle="Automatische Analyse-Mail mit Auffälligkeiten und Tagesaktivität an alle Administratoren."
    >
      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
            <input type="checkbox" name="enabled" defaultChecked={cfg.enabled} className="accent-brand-red" />
            Bericht aktiv
          </label>
          {cfg.lastSent && <span className="text-xs text-gray-400">Zuletzt gesendet: {cfg.lastSent}</span>}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-gray-600">Uhrzeit (Stunde, 0–23)</label>
            <input name="hour" type="number" min={0} max={23} defaultValue={cfg.hour} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Stunden-Schwelle ab (% vom Soll)</label>
            <input
              name="overrunThreshold"
              type="number"
              min={100}
              max={500}
              defaultValue={cfg.overrunThreshold}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm text-gray-600">
            Zusätzliche Empfänger <span className="text-gray-400">(Komma-getrennt; Admins bekommen ihn automatisch)</span>
          </label>
          <input
            name="recipients"
            defaultValue={cfg.recipients}
            placeholder="chef@floortec.design, buero@floortec.design"
            className={inputClass}
          />
        </div>

        {/* Welche Prüfungen laufen */}
        <fieldset className="rounded-md border border-gray-200 p-3">
          <legend className="px-1 text-sm font-medium text-gray-700">Prüfungen</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" name="checkHours" defaultChecked={cfg.checks.hours} className="accent-brand-red" />
              Ist-Stunden über Soll-Kalkulation
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" name="checkNocalc" defaultChecked={cfg.checks.nocalc} className="accent-brand-red" />
              Projekt mit Stunden, aber ohne Kalkulation
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" name="checkLogbook" defaultChecked={cfg.checks.logbook} className="accent-brand-red" />
              Probleme im Logbuch (Stichwörter)
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" name="checkMissing" defaultChecked={cfg.checks.missing} className="accent-brand-red" />
              Mitarbeiter ohne Zeiterfassung
            </label>
          </div>
        </fieldset>

        <div>
          <label className="mb-1 block text-sm text-gray-600">
            Logbuch-Stichwörter <span className="text-gray-400">(Komma-getrennt; leer = Standardliste)</span>
          </label>
          <input
            name="logbookKeywords"
            defaultValue={cfg.logbookKeywords}
            placeholder="problem, mangel, reklamation, verzögerung, defekt …"
            className={inputClass}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-gray-600">
            Eigene Anweisungen an die KI <span className="text-gray-400">(worauf soll der Bericht besonders achten?)</span>
          </label>
          <textarea
            name="instructions"
            rows={3}
            defaultValue={cfg.instructions}
            placeholder="z. B. Betone Projekte über 150 % besonders. Nenne fehlende Zeiterfassung von Monteuren zuerst."
            className={inputClass}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" name="sendWhenEmpty" defaultChecked={cfg.sendWhenEmpty} className="accent-brand-red" />
          Auch senden, wenn es nichts zu berichten gibt (bestätigt, dass der Dienst läuft)
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {pending ? "Speichert …" : "Speichern"}
          </button>
          <button
            type="button"
            disabled={testing}
            onClick={() => {
              setTestMsg(null);
              startTest(async () => {
                const r = await sendTestDailyReportAction();
                setTestMsg({ ok: r.ok, text: r.message });
              });
            }}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-brand-red/50 disabled:opacity-50"
          >
            {testing ? "Sende Test …" : "Testbericht an mich senden"}
          </button>
          {state.error && <span className="text-sm text-rose-600">{state.error}</span>}
          {state.success && <span className="text-sm text-emerald-700">{state.success}</span>}
          {testMsg && (
            <span className={`text-sm ${testMsg.ok ? "text-emerald-700" : "text-rose-600"}`}>
              {testMsg.ok ? "✅" : "⚠️"} {testMsg.text}
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}

export default function AgentsPanel({
  dailyReport,
  workflowCount,
  kiConfigured,
}: {
  dailyReport: DailyReportUiConfig;
  workflowCount: number;
  kiConfigured: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Agenten</h1>
        <p className="mt-1 text-sm text-gray-600">
          Automatische Analyse- und KI-Funktionen des Dashboards zentral verwalten.
        </p>
      </header>

      <DailyReportCard cfg={dailyReport} />

      <Card
        title="⚙️ Workflow-Regeln"
        subtitle="Automatische Aufgaben aus Ereignissen (neuer Beleg → Aufgabe, wiederkehrende Aufgaben u. a.)."
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-700">
            {workflowCount === 0
              ? "Noch keine Regeln angelegt."
              : `${workflowCount} aktive ${workflowCount === 1 ? "Regel" : "Regeln"}.`}
          </p>
          <Link
            href="/dashboard/workflows"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-brand-red/50"
          >
            Workflow-Regeln verwalten →
          </Link>
        </div>
      </Card>

      <Card
        title="💬 KI-Assistent"
        subtitle="Daten-Assistent (Chat) für Fragen zu Umsatz, Kosten, Projekten, Lager u. a."
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-700">
            {kiConfigured ? (
              <span className="text-emerald-700">✓ KI konfiguriert (Anthropic-Schlüssel gesetzt).</span>
            ) : (
              <span className="text-amber-600">⚠️ Kein Anthropic-Schlüssel gesetzt – Assistent und KI-Berichtstext inaktiv.</span>
            )}
          </p>
          <Link
            href="/dashboard/ki"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-brand-red/50"
          >
            Zum Assistenten →
          </Link>
        </div>
      </Card>
    </div>
  );
}
