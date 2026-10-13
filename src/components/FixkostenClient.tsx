"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createFixkostenAction, updateFixkostenAction, deleteFixkostenAction } from "@/app/dashboard/fixkosten/actions";
import type { FixkostenItem } from "@/lib/fixkosten";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60";

function fmtEur(n: number): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function Row({ item }: { item: FixkostenItem }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [amount, setAmount] = useState(String(item.monthlyAmount).replace(".", ","));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await updateFixkostenAction(item.id, name, amount);
      if (!res.ok) {
        setError(res.error ?? "Fehler beim Speichern");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  const remove = () => {
    if (!confirm(`„${item.name}“ wirklich löschen?`)) return;
    startTransition(async () => {
      await deleteFixkostenAction(item.id);
      router.refresh();
    });
  };

  if (editing) {
    return (
      <tr className="border-b border-gray-100">
        <td className="px-4 py-2">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </td>
        <td className="px-4 py-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className={`${inputClass} text-right`}
          />
        </td>
        <td className="px-4 py-2 text-right">
          <div className="flex items-center justify-end gap-2">
            {error && <span className="text-xs text-rose-600">{error}</span>}
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded-md bg-brand-red px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              Speichern
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setName(item.name);
                setAmount(String(item.monthlyAmount).replace(".", ","));
                setError(null);
              }}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              Abbrechen
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-gray-100 last:border-0">
      <td className="px-4 py-2.5 font-medium text-gray-900">{item.name}</td>
      <td className="px-4 py-2.5 text-right text-gray-600">{fmtEur(item.monthlyAmount)}</td>
      <td className="px-4 py-2.5 text-right">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
          >
            Bearbeiten
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="rounded-md border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
          >
            Löschen
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function FixkostenClient({ items }: { items: FixkostenItem[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const total = items.reduce((sum, i) => sum + i.monthlyAmount, 0);

  const submit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const res = await createFixkostenAction(formData);
      if (!res.ok) {
        setError(res.error ?? "Fehler beim Anlegen");
        return;
      }
      formRef.current?.reset();
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <form ref={formRef} action={submit} className="flex flex-wrap items-end gap-2 border border-line bg-white p-4">
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-xs text-gray-500">Bezeichnung *</label>
          <input name="name" placeholder="z. B. Miete Halle" className={inputClass} required />
        </div>
        <div className="w-40">
          <label className="mb-1 block text-xs text-gray-500">Monatlicher Betrag € *</label>
          <input name="monthlyAmount" inputMode="decimal" placeholder="0,00" className={inputClass} required />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Legt an …" : "Hinzufügen"}
        </button>
        {error && <span className="text-xs text-rose-600">{error}</span>}
      </form>

      <div className="overflow-x-auto border border-line bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="px-4 py-2.5">Bezeichnung</th>
              <th className="px-4 py-2.5 text-right">Monatlicher Betrag</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-sm text-gray-500">
                  Noch keine Fixkosten erfasst.
                </td>
              </tr>
            ) : (
              items.map((item) => <Row key={item.id} item={item} />)
            )}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-gray-900">
                <td className="px-4 py-2.5">Summe pro Monat</td>
                <td className="px-4 py-2.5 text-right">{fmtEur(total)}</td>
                <td className="px-4 py-2.5" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
