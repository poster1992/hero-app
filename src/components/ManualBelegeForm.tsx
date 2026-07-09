"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useActionState } from "react";
import {
  uploadBelegAction,
  updateBelegAction,
  computeBelegSumAction,
  type UploadBelegState,
} from "@/app/dashboard/belege/manual-actions";

interface AccountOption {
  number: string;
  name: string;
}

/** Subset of a manual receipt needed to prefill the edit form. */
export interface EditableReceipt {
  id: number;
  date: string | null;
  supplier: string | null;
  description: string | null;
  gross: number;
  vatRate: number | null;
  accountNumber: string | null;
  accountName: string | null;
  fileName: string | null;
}

export default function ManualBelegeForm({
  accounts,
  receipt,
}: {
  accounts: AccountOption[];
  /** When set, the form edits this receipt instead of creating a new one. */
  receipt?: EditableReceipt;
}) {
  const isEdit = !!receipt;
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<UploadBelegState, FormData>(
    isEdit ? updateBelegAction : uploadBelegAction,
    {}
  );
  const [accountQuery, setAccountQuery] = useState("");
  const [account, setAccount] = useState<AccountOption | null>(
    receipt?.accountNumber
      ? { number: receipt.accountNumber, name: receipt.accountName ?? "" }
      : null
  );

  // OCR-Summe je Seite (Lohn: „Total Brutto", BGL: „Total TTC à payer").
  const fileInputRef = useRef<HTMLInputElement>(null);
  const grossInputRef = useRef<HTMLInputElement>(null);
  const vatInputRef = useRef<HTMLInputElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const supplierInputRef = useRef<HTMLInputElement>(null);
  const descInputRef = useRef<HTMLInputElement>(null);
  const [belegTyp, setBelegTyp] = useState<"" | "lohn" | "bgl">("");
  const [sumBusy, startSum] = useTransition();
  const [sumMsg, setSumMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const sumLabel = belegTyp === "bgl" ? "Total TTC" : "Total Brutto";

  const runSum = () => {
    if (belegTyp !== "lohn" && belegTyp !== "bgl") return;
    const file = fileInputRef.current?.files?.[0] ?? null;
    if (!file) {
      setSumMsg({ ok: false, text: "Bitte zuerst die Datei auswählen." });
      return;
    }
    setSumMsg(null);
    startSum(async () => {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("kind", belegTyp);
      const res = await computeBelegSumAction(fd);
      if (res.ok && res.total != null) {
        if (grossInputRef.current) grossInputRef.current.value = res.total.toFixed(2).replace(".", ",");
        if (res.vatRate != null && vatInputRef.current) {
          vatInputRef.current.value = String(res.vatRate).replace(".", ",");
        }
        if (res.date && dateInputRef.current) dateInputRef.current.value = res.date;
        if (res.supplier && supplierInputRef.current) supplierInputRef.current.value = res.supplier;
        if (res.description && descInputRef.current) descInputRef.current.value = res.description;
        setSumMsg({
          ok: true,
          text:
            `${res.count} ${res.count === 1 ? "Seite" : "Seiten"} · Summe ${sumLabel} ${res.total.toLocaleString(
              "de-DE",
              { minimumFractionDigits: 2, maximumFractionDigits: 2 }
            )} €` +
            (res.vatRate != null ? ` · MwSt ${res.vatRate} %` : "") +
            (res.date ? ` · Datum ${res.date.split("-").reverse().join(".")}` : ""),
        });
      } else {
        setSumMsg({ ok: false, text: res.error ?? "OCR fehlgeschlagen." });
      }
    });
  };

  // Nach erfolgreichem Speichern Pop-up schließen (deferred, um setState
  // synchron im Effekt zu vermeiden).
  const lastSuccess = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!state.success || state.success === lastSuccess.current) return;
    lastSuccess.current = state.success;
    const t = setTimeout(() => {
      setOpen(false);
      if (!isEdit) {
        setAccount(null);
        setAccountQuery("");
      }
    }, 0);
    return () => clearTimeout(t);
  }, [state.success, isEdit]);

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

  const grossDefault = receipt ? String(receipt.gross).replace(".", ",") : "";
  const vatDefault = receipt?.vatRate != null ? String(receipt.vatRate) : "";

  return (
    <div className={isEdit ? "inline-block" : "flex items-center justify-end"}>
      {isEdit ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
        >
          Bearbeiten
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          + Beleg hochladen
        </button>
      )}

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
              <h2 className="text-lg font-semibold text-gray-900">
                {isEdit ? "Beleg bearbeiten" : "Beleg manuell hochladen"}
              </h2>
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
              {isEdit && <input type="hidden" name="id" value={receipt.id} />}
              <div>
                <label className="mb-1 block text-sm text-gray-600">
                  {isEdit ? "Datei ersetzen (optional)" : "Datei (PDF/Bild)"}
                </label>
                <input
                  ref={fileInputRef}
                  name="file"
                  type="file"
                  accept=".pdf,image/*"
                  className="w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-red file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:opacity-90"
                />
                {isEdit && receipt.fileName && (
                  <p className="mt-1 text-xs text-gray-500">Aktuell: {receipt.fileName}</p>
                )}
                {/* OCR-Summe je Seite (Lohn: Total Brutto, BGL: Total TTC) → Betrag füllen. */}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    value={belegTyp}
                    onChange={(e) => {
                      setBelegTyp(e.target.value as "" | "lohn" | "bgl");
                      setSumMsg(null);
                    }}
                    title="Für mehrseitige Sammelbelege: Summe je Seite automatisch aus dem PDF berechnen"
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 outline-none focus:border-brand-red/60"
                  >
                    <option value="">Typ: Standard</option>
                    <option value="lohn">Typ: Lohn</option>
                    <option value="bgl">Typ: BGL-Leasing</option>
                  </select>
                  {(belegTyp === "lohn" || belegTyp === "bgl") && (
                    <button
                      type="button"
                      onClick={runSum}
                      disabled={sumBusy}
                      title={`Liest je Seite „${sumLabel}" und trägt die Summe als Betrag ein`}
                      className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900 disabled:opacity-50"
                    >
                      {sumBusy ? "Rechne …" : `🧮 ${sumLabel}-Summe aus PDF`}
                    </button>
                  )}
                  {sumMsg && (
                    <span className={`text-xs ${sumMsg.ok ? "text-emerald-700" : "text-rose-600"}`}>
                      {sumMsg.text}
                    </span>
                  )}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">Belegdatum</label>
                <input ref={dateInputRef} name="date" type="date" defaultValue={receipt?.date ?? ""} className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">Lieferant</label>
                <input
                  ref={supplierInputRef}
                  name="supplier"
                  type="text"
                  defaultValue={receipt?.supplier ?? ""}
                  className={inputClass}
                  placeholder="z. B. Baumarkt XY"
                />
              </div>
              <div className="lg:col-span-3">
                <label className="mb-1 block text-sm text-gray-600">Beschreibung</label>
                <input
                  ref={descInputRef}
                  name="description"
                  type="text"
                  defaultValue={receipt?.description ?? ""}
                  className={inputClass}
                  placeholder="Verwendungszweck"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">Betrag (brutto) *</label>
                <input
                  ref={grossInputRef}
                  name="gross"
                  type="text"
                  inputMode="decimal"
                  required
                  defaultValue={grossDefault}
                  className={inputClass}
                  placeholder="z. B. 119,00"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">MwSt-Satz %</label>
                <input
                  ref={vatInputRef}
                  name="vatRate"
                  type="text"
                  inputMode="decimal"
                  defaultValue={vatDefault}
                  className={inputClass}
                  placeholder="z. B. 17"
                />
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
                  {pending
                    ? "Wird gespeichert …"
                    : isEdit
                      ? "Änderungen speichern"
                      : "Beleg speichern"}
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
