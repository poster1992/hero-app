"use client";

import { useActionState } from "react";
import {
  addBaustelleAction,
  deleteBaustelleAction,
  type SettingsState,
} from "@/app/dashboard/einstellungen/actions";
import type { BaustelleDoc } from "@/lib/baustellen-docs";

export default function BaustellenAdmin({ items }: { items: BaustelleDoc[] }) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(
    addBaustelleAction,
    {}
  );

  return (
    <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
      <h2 className="mb-1 text-lg font-semibold text-gray-900">Baustellen-Dokumentation</h2>
      <p className="mb-4 text-sm text-gray-600">
        Menüpunkte für Baustellen-Fotos anlegen. Die Fotos werden live aus dem HERO-Projekt geladen
        (Kategorie „Dokumentation") – es wird nichts auf dem Server gespeichert.
      </p>

      {items.length > 0 && (
        <ul className="mb-4 divide-y divide-gray-100 rounded-md border border-gray-200">
          {items.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="font-medium text-gray-900">{b.label}</span>
              <span className="text-gray-500">
                · {b.projectNr}
                {b.projectName ? ` – ${b.projectName}` : ""} · Kategorie „{b.imageCategory}"
              </span>
              <form action={deleteBaustelleAction} className="ml-auto">
                <input type="hidden" name="id" value={b.id} />
                <button
                  type="submit"
                  className="rounded-md border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 hover:border-brand-red/50 hover:text-brand-red"
                >
                  Entfernen
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Menü-Name *</label>
            <input
              name="label"
              placeholder="z. B. MFH - TR-EUREN"
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-red/60"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Projektnummer *</label>
            <input
              name="projectNr"
              placeholder="z. B. PRJ-199"
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-red/60"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Bild-Kategorie</label>
            <input
              name="imageCategory"
              defaultValue="Dokumentation"
              placeholder="Dokumentation"
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-red/60"
            />
          </div>
        </div>

        {state.error && <p className="text-sm text-brand-red">{state.error}</p>}
        {state.success && <p className="text-sm text-emerald-600">{state.success}</p>}

        <div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Wird geprüft …" : "Menüpunkt hinzufügen"}
          </button>
        </div>
      </form>
    </div>
  );
}
