"use client";

import { useActionState } from "react";
import { saveGoogleReviewUrlAction, type SettingsState } from "@/app/dashboard/einstellungen/actions";

export default function SettingsForm({ googleReviewUrl }: { googleReviewUrl: string }) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(
    saveGoogleReviewUrlAction,
    {}
  );

  return (
    <div className="max-w-2xl rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
      <h2 className="text-lg font-medium text-gray-900">Google-Bewertung</h2>
      <p className="mt-1 text-sm text-gray-600">
        Link zu eurer Google-Bewertungsseite. Er wird aus der Aufgabe „Kunde anrufen – Zufriedenheit
        erfragen" per E-Mail an den Kunden verschickt.
      </p>

      <form action={formAction} className="mt-4 flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-sm text-gray-600">Google-Bewertungslink</label>
          <input
            name="googleReviewUrl"
            type="url"
            defaultValue={googleReviewUrl}
            placeholder="https://g.page/r/XXXXXXXXXXXX/review"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60"
          />
          <p className="mt-1 text-xs text-gray-400">
            Zu finden im Google-Unternehmensprofil unter „Bewertungen → Mehr Rezensionen erhalten"
            (Kurz-URL <code>g.page/r/…/review</code>). Leer lassen = deaktiviert.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Speichert …" : "Speichern"}
          </button>
          {state.error && <span className="text-sm text-rose-600">{state.error}</span>}
          {state.success && <span className="text-sm text-emerald-600">{state.success}</span>}
        </div>
      </form>
    </div>
  );
}
