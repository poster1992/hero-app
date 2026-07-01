"use client";

import { useActionState, useState, useTransition } from "react";
import {
  saveGoogleReviewUrlAction,
  saveSmtpAction,
  sendTestMailAction,
  saveGooglePlacesAction,
  checkGoogleReviewsAction,
  type SettingsState,
} from "@/app/dashboard/einstellungen/actions";

interface SmtpProps {
  host: string;
  port: string;
  user: string;
  from: string;
  passSet: boolean;
}

interface PlacesProps {
  placeId: string;
  apiKeySet: boolean;
}

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60";

export default function SettingsForm({
  googleReviewUrl,
  smtp,
  places,
}: {
  googleReviewUrl: string;
  smtp: SmtpProps;
  places: PlacesProps;
}) {
  const [gState, gAction, gPending] = useActionState<SettingsState, FormData>(saveGoogleReviewUrlAction, {});
  const [sState, sAction, sPending] = useActionState<SettingsState, FormData>(saveSmtpAction, {});
  const [pState, pAction, pPending] = useActionState<SettingsState, FormData>(saveGooglePlacesAction, {});
  const [testTo, setTestTo] = useState("");
  const [testing, startTest] = useTransition();
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [checking, startCheck] = useTransition();
  const [checkMsg, setCheckMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const runTest = () => {
    setTestMsg(null);
    startTest(async () => {
      const r = await sendTestMailAction(testTo);
      setTestMsg({ ok: r.ok, text: r.message });
    });
  };

  const runCheck = () => {
    setCheckMsg(null);
    startCheck(async () => {
      const r = await checkGoogleReviewsAction();
      setCheckMsg({ ok: r.ok, text: r.message });
    });
  };

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {/* E-Mail-Versand (SMTP) */}
      <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
        <h2 className="text-lg font-medium text-gray-900">E-Mail-Versand (SMTP)</h2>
        <p className="mt-1 text-sm text-gray-600">
          Für Aufgaben-Benachrichtigungen und E-Mails aus dem Dashboard. Für Microsoft 365:
          Host <code>smtp.office365.com</code>, Port <code>587</code>, Benutzer = Postfach,
          Passwort = <strong>App-Kennwort</strong> (bei aktiver MFA). „Authentifiziertes SMTP" muss
          für das Postfach freigeschaltet sein.
        </p>

        <form action={sAction} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm text-gray-600">SMTP-Host</label>
            <input name="smtpHost" defaultValue={smtp.host} placeholder="smtp.office365.com" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Port</label>
            <input name="smtpPort" defaultValue={smtp.port || "587"} placeholder="587" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Benutzer (Postfach)</label>
            <input name="smtpUser" defaultValue={smtp.user} placeholder="no-reply@floortec.design" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">
              Passwort / App-Kennwort {smtp.passSet && <span className="text-emerald-600">(gesetzt)</span>}
            </label>
            <input
              name="smtpPass"
              type="password"
              autoComplete="new-password"
              placeholder={smtp.passSet ? "•••••••• (leer lassen = unverändert)" : "App-Kennwort"}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Absender (From)</label>
            <input name="smtpFrom" defaultValue={smtp.from} placeholder="FLOORTEC <no-reply@floortec.design>" className={inputClass} />
          </div>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <button type="submit" disabled={sPending} className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {sPending ? "Speichert …" : "SMTP speichern"}
            </button>
            {sState.error && <span className="text-sm text-rose-600">{sState.error}</span>}
            {sState.success && <span className="text-sm text-emerald-600">{sState.success}</span>}
          </div>
        </form>

        {/* Testmail */}
        <div className="mt-4 border-t border-gray-200 pt-4">
          <label className="mb-1 block text-sm text-gray-600">Testmail senden an</label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="deine@adresse.de (leer = dein Konto)"
              className={`${inputClass} max-w-xs`}
            />
            <button
              type="button"
              onClick={runTest}
              disabled={testing}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:border-brand-red/50 disabled:opacity-50"
            >
              {testing ? "Sende …" : "Testmail senden"}
            </button>
            {testMsg && <span className={`text-sm ${testMsg.ok ? "text-emerald-600" : "text-rose-600"}`}>{testMsg.text}</span>}
          </div>
          <p className="mt-1 text-xs text-gray-400">Prüft Verbindung + Anmeldung und verschickt eine Testmail (bitte zuerst speichern).</p>
        </div>
      </div>

      {/* Google-Bewertung */}
      <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
        <h2 className="text-lg font-medium text-gray-900">Google-Bewertung</h2>
        <p className="mt-1 text-sm text-gray-600">
          Link zu eurer Google-Bewertungsseite (für die Aufgabe „Kunde anrufen – Zufriedenheit erfragen").
        </p>
        <form action={gAction} className="mt-4 flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-sm text-gray-600">Google-Bewertungslink</label>
            <input
              name="googleReviewUrl"
              type="url"
              defaultValue={googleReviewUrl}
              placeholder="https://g.page/r/XXXXXXXXXXXX/review"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-gray-400">Leer lassen = deaktiviert.</p>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={gPending} className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {gPending ? "Speichert …" : "Speichern"}
            </button>
            {gState.error && <span className="text-sm text-rose-600">{gState.error}</span>}
            {gState.success && <span className="text-sm text-emerald-600">{gState.success}</span>}
          </div>
        </form>
      </div>

      {/* Google-Rezensionen abrufen (Places API) */}
      <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
        <h2 className="text-lg font-medium text-gray-900">Google-Rezensionen (Zähler)</h2>
        <p className="mt-1 text-sm text-gray-600">
          Zeigt in der Unternehmensübersicht die Anzahl + Ø-Bewertung eurer Google-Rezensionen.
          Benötigt einen <strong>Google-API-Key</strong> (Places API aktiviert, Billing an) und die
          <strong> Place-ID</strong> eures Eintrags (zu finden über den{" "}
          <a href="https://developers.google.com/maps/documentation/places/web-service/place-id" target="_blank" rel="noopener noreferrer" className="text-brand-red hover:underline">Place ID Finder</a>).
        </p>
        <form action={pAction} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-gray-600">Place-ID</label>
            <input name="placeId" defaultValue={places.placeId} placeholder="ChIJ..." className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">
              Google-API-Key {places.apiKeySet && <span className="text-emerald-600">(gesetzt)</span>}
            </label>
            <input
              name="apiKey"
              type="password"
              autoComplete="new-password"
              placeholder={places.apiKeySet ? "•••••••• (leer lassen = unverändert)" : "AIza…"}
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <button type="submit" disabled={pPending} className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {pPending ? "Speichert …" : "Speichern"}
            </button>
            <button type="button" onClick={runCheck} disabled={checking} className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:border-brand-red/50 disabled:opacity-50">
              {checking ? "Prüfe …" : "Jetzt prüfen"}
            </button>
            {pState.error && <span className="text-sm text-rose-600">{pState.error}</span>}
            {pState.success && <span className="text-sm text-emerald-600">{pState.success}</span>}
            {checkMsg && <span className={`text-sm ${checkMsg.ok ? "text-emerald-600" : "text-rose-600"}`}>{checkMsg.text}</span>}
          </div>
        </form>
      </div>
    </div>
  );
}
