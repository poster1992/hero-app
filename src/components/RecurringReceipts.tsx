"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  listRecurringAction,
  saveRecurringAction,
  setRecurringActiveAction,
  deleteRecurringAction,
  generateRecurringAction,
} from "@/app/dashboard/belege/recurring-actions";
import type { RecurringTemplate } from "@/lib/recurring-receipts";

interface AccountOption {
  number: string;
  name: string;
}
interface SupplierOption {
  id: number;
  name: string;
}

const currency = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const inputClass =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60";

interface FormState {
  id: number | null;
  supplier: string;
  description: string;
  gross: string;
  vatRate: string;
  account: string; // "number|name"
  dayOfMonth: string;
  active: boolean;
}

const emptyForm: FormState = {
  id: null,
  supplier: "",
  description: "",
  gross: "",
  vatRate: "",
  account: "",
  dayOfMonth: "1",
  active: true,
};

export default function RecurringReceipts({
  accounts,
  suppliers,
  year,
  month,
}: {
  accounts: AccountOption[];
  suppliers: SupplierOption[];
  /** Vorbelegter Monat für „erzeugen" (aktuell betrachteter Monat). */
  year: number;
  month: number; // 1-basiert
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<RecurringTemplate[]>([]);
  const [loading, startLoad] = useTransition();
  const [form, setForm] = useState<FormState | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [genYear, setGenYear] = useState(year);
  const [genMonth, setGenMonth] = useState(month);

  const reload = () => {
    startLoad(async () => {
      setTemplates(await listRecurringAction());
    });
  };

  useEffect(() => {
    if (open) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const accountLabel = (num: string | null) => {
    if (!num) return "—";
    const a = accounts.find((x) => x.number === num);
    return a ? `${a.number} – ${a.name}` : num;
  };

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setMsg(null);
    const res = await saveRecurringAction({
      id: form.id,
      supplier: form.supplier,
      description: form.description,
      gross: form.gross,
      vatRate: form.vatRate,
      account: form.account,
      dayOfMonth: form.dayOfMonth,
      active: form.active,
    });
    setBusy(false);
    if (res.ok) {
      setForm(null);
      reload();
    } else {
      setMsg({ ok: false, text: res.error ?? "Fehler." });
    }
  };

  const toggleActive = (t: RecurringTemplate) => {
    startLoad(async () => {
      await setRecurringActiveAction(t.id, !t.active);
      setTemplates(await listRecurringAction());
    });
  };

  const remove = (t: RecurringTemplate) => {
    if (!window.confirm(`Vorlage „${t.supplier || t.description || t.id}" löschen?`)) return;
    startLoad(async () => {
      await deleteRecurringAction(t.id);
      setTemplates(await listRecurringAction());
    });
  };

  const generate = async () => {
    setBusy(true);
    setMsg(null);
    const res = await generateRecurringAction(genYear, genMonth);
    setBusy(false);
    if (res.ok && res.result) {
      const { created, skipped } = res.result;
      setMsg({
        ok: true,
        text: `${created} Beleg(e) erzeugt${skipped ? `, ${skipped} bereits vorhanden` : ""} für ${MONTHS[genMonth - 1]} ${genYear}.`,
      });
      router.refresh();
    } else {
      setMsg({ ok: false, text: res.error ?? "Fehler beim Erzeugen." });
    }
  };

  const activeCount = templates.filter((t) => t.active).length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
      >
        🔁 Wiederkehrende Belege
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div
            className="my-6 w-full max-w-2xl border border-line bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
              <h2 className="text-base font-semibold text-gray-900">Wiederkehrende Belege</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700" aria-label="Schließen">
                ✕
              </button>
            </div>

            <div className="max-h-[80vh] overflow-y-auto p-5">
              {/* Erzeugen */}
              <div className="mb-5 border border-line bg-gray-50 p-4">
                <p className="mb-2 text-sm font-semibold text-gray-900">Belege für einen Monat erzeugen</p>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={genMonth}
                    onChange={(e) => setGenMonth(Number(e.target.value))}
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                  >
                    {MONTHS.map((m, i) => (
                      <option key={i} value={i + 1}>{m}</option>
                    ))}
                  </select>
                  <select
                    value={genYear}
                    onChange={(e) => setGenYear(Number(e.target.value))}
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                  >
                    {[year - 1, year, year + 1].map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={generate}
                    disabled={busy || activeCount === 0}
                    className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {busy ? "Erzeugt …" : `${activeCount} Beleg(e) erzeugen`}
                  </button>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Es werden alle <strong>aktiven</strong> Vorlagen als dateilose Belege angelegt. Bereits erzeugte
                  Belege dieses Monats werden übersprungen (kein Doppel).
                </p>
                {msg && (
                  <p className={`mt-2 text-sm ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg.text}</p>
                )}
              </div>

              {/* Vorlagen-Liste */}
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">Vorlagen ({templates.length})</p>
                {!form && (
                  <button
                    type="button"
                    onClick={() => setForm({ ...emptyForm })}
                    className="rounded-md bg-brand-red px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                  >
                    + Neue Vorlage
                  </button>
                )}
              </div>

              {form && (
                <div className="mb-4 border border-line bg-white p-4">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-medium text-gray-600">Lieferant</label>
                      <input
                        list="rec-suppliers"
                        value={form.supplier}
                        onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                        placeholder="z. B. Vermieter, Leasinggeber …"
                        className={inputClass}
                      />
                      <datalist id="rec-suppliers">
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.name} />
                        ))}
                      </datalist>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-medium text-gray-600">Beschreibung</label>
                      <input
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                        placeholder="z. B. Miete Halle, Leasing VW Crafter"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">Betrag (brutto) *</label>
                      <input
                        value={form.gross}
                        onChange={(e) => setForm({ ...form, gross: e.target.value })}
                        inputMode="decimal"
                        placeholder="z. B. 1200,00"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">MwSt-Satz %</label>
                      <input
                        value={form.vatRate}
                        onChange={(e) => setForm({ ...form, vatRate: e.target.value })}
                        inputMode="decimal"
                        placeholder="z. B. 17"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">Konto</label>
                      <select
                        value={form.account}
                        onChange={(e) => setForm({ ...form, account: e.target.value })}
                        className={inputClass}
                      >
                        <option value="">— Konto wählen —</option>
                        {accounts.map((a) => (
                          <option key={a.number} value={`${a.number}|${a.name}`}>
                            {a.number} – {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">Tag im Monat (Belegdatum)</label>
                      <input
                        value={form.dayOfMonth}
                        onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value })}
                        inputMode="numeric"
                        placeholder="1"
                        className={inputClass}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={form.active}
                        onChange={(e) => setForm({ ...form, active: e.target.checked })}
                      />
                      Aktiv (wird beim Erzeugen berücksichtigt)
                    </label>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={save}
                      disabled={busy}
                      className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {busy ? "Speichert …" : "Speichern"}
                    </button>
                    <button type="button" onClick={() => setForm(null)} className="text-sm text-gray-500 hover:text-gray-800">
                      Abbrechen
                    </button>
                  </div>
                </div>
              )}

              {loading && templates.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-500">Wird geladen …</p>
              ) : templates.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-500">Noch keine Vorlagen. Lege oben die erste an.</p>
              ) : (
                <ul className="divide-y divide-gray-100 border border-line">
                  {templates.map((t) => (
                    <li key={t.id} className={`flex items-center gap-3 px-3 py-2.5 ${t.active ? "" : "opacity-55"}`}>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-gray-900">
                          {t.supplier || t.description || `Vorlage #${t.id}`}
                          {!t.active && <span className="ml-2 text-xs font-normal text-gray-400">(inaktiv)</span>}
                        </div>
                        <div className="truncate text-xs text-gray-500">
                          {t.description && t.supplier ? `${t.description} · ` : ""}
                          Konto {accountLabel(t.accountNumber)} · Tag {t.dayOfMonth}
                          {t.vatRate != null ? ` · ${t.vatRate} % MwSt` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-sm font-semibold tabular-nums text-gray-900">
                        {currency.format(t.gross)}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleActive(t)}
                          title={t.active ? "Deaktivieren" : "Aktivieren"}
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:border-brand-red/50 hover:text-brand-red"
                        >
                          {t.active ? "aktiv" : "aus"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setForm({
                              id: t.id,
                              supplier: t.supplier ?? "",
                              description: t.description ?? "",
                              gross: String(t.gross).replace(".", ","),
                              vatRate: t.vatRate != null ? String(t.vatRate) : "",
                              account: t.accountNumber ? `${t.accountNumber}|${t.accountName ?? ""}` : "",
                              dayOfMonth: String(t.dayOfMonth),
                              active: t.active,
                            })
                          }
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:border-brand-red/50 hover:text-brand-red"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(t)}
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:border-brand-red/50 hover:text-brand-red"
                        >
                          🗑
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
