"use client";

import { usePush } from "@/components/usePush";

export default function PushSetup() {
  const { state, busy, msg, enable, disable, test } = usePush();

  if (state === "loading" || state === "unsupported") return null;

  const box = "rounded-xl border border-gray-300 bg-white p-4 shadow-lg shadow-black/10";

  if (state === "ios-needs-install") {
    return (
      <div className={box}>
        <p className="text-sm font-medium text-gray-900">📲 Push am iPhone aktivieren</p>
        <p className="mt-1 text-sm text-gray-600">
          Damit du Mitteilungen erhältst, die App einmalig zum Home-Bildschirm hinzufügen:
          in Safari unten auf <strong>Teilen</strong> → <strong>„Zum Home-Bildschirm"</strong>.
          Danach die App <strong>vom Home-Bildschirm</strong> öffnen und hier „Aktivieren" tippen.
        </p>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className={box}>
        <p className="text-sm text-gray-700">
          🔕 Benachrichtigungen sind blockiert. Bitte in den Einstellungen für diese App/Website
          Mitteilungen erlauben und die Seite neu laden.
        </p>
      </div>
    );
  }

  return (
    <div className={`${box} flex flex-wrap items-center gap-3`}>
      <span className="text-sm text-gray-700">
        {state === "subscribed"
          ? "🔔 Push-Benachrichtigungen sind aktiv."
          : "🔔 Erhalte Mitteilungen bei neuen Aufgaben und Rückmeldungen."}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {state === "subscribed" ? (
          <>
            <button
              type="button"
              onClick={test}
              disabled={busy}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 disabled:opacity-50"
            >
              Test senden
            </button>
            <button
              type="button"
              onClick={disable}
              disabled={busy}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 disabled:opacity-50"
            >
              Deaktivieren
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="rounded-md bg-brand-red px-4 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "…" : "Aktivieren"}
          </button>
        )}
      </div>
      {msg && <span className="w-full text-xs text-gray-500">{msg}</span>}
    </div>
  );
}
