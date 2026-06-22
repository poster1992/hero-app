"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { uploadBelegAction, type UploadBelegState } from "@/app/dashboard/belege/manual-actions";

interface AccountOption {
  number: string;
  name: string;
}

export default function ManualBelegeForm({ accounts }: { accounts: AccountOption[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<UploadBelegState, FormData>(
    uploadBelegAction,
    {}
  );
  const [accountQuery, setAccountQuery] = useState("");
  const [account, setAccount] = useState<AccountOption | null>(null);

  // Nach erfolgreichem Speichern Pop-up schließen und Felder zurücksetzen.
  const lastSuccess = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (state.success && state.success !== lastSuccess.current) {
      lastSuccess.current = state.success;
      setOpen(false);
      setAccount(null);
      setAccountQuery("");
    }
  }, [state.success]);

  const accountMatches = (() => {
    const words = accountQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0 || account) return [];
    return accounts
      .filter((a) => {
        const hay = `${a.number} ${a.name}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 12);
  })();

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60";

  return (
    <div className="flex items-center justify-end">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
      >
        + Beleg hochladen
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-3xl rounded-xl border border-gray-300 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Beleg manuell hochladen</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-gray-400 transition-colors hover:text-gray-700"
                aria-label="Schließen"
              >
                ✕
              </button>
            </div>

            <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm text-gray-600">Datei (PDF/Bild)</label>
                <input
                  name="file"
                  type="file"
                  accept=".pdf,image/*"
                  className="w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-red file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:opacity-90"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">Belegdatum</label>
                <input name="date" type="date" className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">Lieferant</label>
                <input name="supplier" type="text" className={inputClass} placeholder="z. B. Baumarkt XY" />
              </div>
              <div className="lg:col-span-3">
                <label className="mb-1 block text-sm text-gray-600">Beschreibung</label>
                <input name="description" type="text" className={inputClass} placeholder="Verwendungszweck" />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">Betrag (brutto) *</label>
                <input name="gross" type="text" inputMode="decimal" required className={inputClass} placeholder="z. B. 119,00" />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">MwSt-Satz %</label>
                <input name="vatRate" type="text" inputMode="decimal" className={inputClass} placeholder="z. B. 17" />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">Konto *</label>
                {/* trägt die Auswahl ins Formular */}
                <input type="hidden" name="account" value={account ? `${account.number}|${account.name}` : ""} />
                {account ? (
                  <div className="flex items-center justify-between rounded-md border border-gray-300 px-3 py-2 text-sm">
                    <span className="text-gray-900">
                      {account.number} – {account.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setAccount(null);
                        setAccountQuery("");
                      }}
                      className="text-xs text-gray-400 hover:text-gray-700"
                    >
                      ✕ ändern
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="text"
                      value={accountQuery}
                      onChange={(e) => setAccountQuery(e.target.value)}
                      placeholder="Konto suchen (Nr. oder Schlagwort) …"
                      className={inputClass}
                    />
                    {accountMatches.length > 0 && (
                      <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                        {accountMatches.map((a) => (
                          <li key={a.number}>
                            <button
                              type="button"
                              onClick={() => {
                                setAccount(a);
                                setAccountQuery("");
                              }}
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100"
                            >
                              <span className="text-gray-500">{a.number}</span> {a.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-4 sm:col-span-2 lg:col-span-3">
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {pending ? "Wird gespeichert …" : "Beleg speichern"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Abbrechen
                </button>
                {state.error && <span className="text-sm text-rose-600">{state.error}</span>}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
