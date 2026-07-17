"use client";

import { useActionState, useMemo, useState } from "react";
import {
  saveSupplierIbanAction,
  setDirectDebitAction,
  type SaveIbanState,
} from "@/app/dashboard/belege/sepa-actions";

export interface SupplierIbanItem {
  customerId: number;
  name: string;
  iban: string;
  bic: string;
  directDebit: boolean;
  skontoDays: number | null;
  skontoPercent: number | null;
}

function SupplierRow({ item }: { item: SupplierIbanItem }) {
  const [state, action, pending] = useActionState<SaveIbanState, FormData>(
    saveSupplierIbanAction,
    {}
  );
  const [dd, setDd] = useState(item.directDebit);
  const has = item.iban.trim().length > 0;
  return (
    <tr className="border-b border-gray-200 last:border-0 hover:bg-gray-100">
      <td className="px-4 py-2 align-middle">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            dd ? "bg-violet-500" : has ? "bg-emerald-500" : "bg-gray-300"
          }`}
          title={dd ? "Bankeinzug" : has ? "IBAN hinterlegt" : "keine IBAN"}
        />
      </td>
      <td className="px-4 py-2 align-middle text-gray-900">{item.name}</td>
      <td className="px-4 py-2">
        <form action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="customerId" value={item.customerId} />
          <input type="hidden" name="name" value={item.name} />
          <input
            name="iban"
            required
            defaultValue={item.iban}
            placeholder="IBAN"
            className="min-w-[13rem] flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 outline-none focus:border-brand-red/60"
          />
          <input
            name="bic"
            defaultValue={item.bic}
            placeholder="BIC (optional)"
            className="w-32 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 outline-none focus:border-brand-red/60"
          />
          <div className="flex items-center gap-1">
            <input
              name="skontoDays"
              type="number"
              min={0}
              max={365}
              defaultValue={item.skontoDays ?? ""}
              placeholder="Tage"
              className="w-16 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 outline-none focus:border-brand-red/60"
            />
            <input
              name="skontoPercent"
              type="number"
              min={0}
              max={100}
              step="0.01"
              defaultValue={item.skontoPercent ?? ""}
              placeholder="%"
              className="w-16 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 outline-none focus:border-brand-red/60"
            />
            <span className="text-xs text-gray-500">Skonto (Tage / %)</span>
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 disabled:opacity-50"
          >
            {pending ? "…" : "Speichern"}
          </button>
          {state.error && <span className="text-xs text-rose-600">{state.error}</span>}
          {state.success && <span className="text-xs text-emerald-700">✓</span>}
        </form>
      </td>
      <td className="px-4 py-2 align-middle">
        <form action={setDirectDebitAction}>
          <input type="hidden" name="customerId" value={item.customerId} />
          <input type="hidden" name="name" value={item.name} />
          <label className="flex items-center gap-1.5 text-sm text-gray-700">
            <input
              type="checkbox"
              name="directDebit"
              value="1"
              checked={dd}
              onChange={(e) => {
                setDd(e.target.checked);
                e.currentTarget.form?.requestSubmit();
              }}
            />
            Bankeinzug
          </label>
        </form>
      </td>
    </tr>
  );
}

export default function SupplierIbanManager({ suppliers }: { suppliers: SupplierIbanItem[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "with" | "missing" | "debit">("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suppliers.filter((s) => {
      const has = s.iban.trim().length > 0;
      if (filter === "with" && !has) return false;
      if (filter === "missing" && has) return false;
      if (filter === "debit" && !s.directDebit) return false;
      if (q && !s.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [suppliers, search, filter]);

  const withIban = suppliers.filter((s) => s.iban.trim().length > 0).length;
  const withDebit = suppliers.filter((s) => s.directDebit).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Lieferant suchen …"
          className="w-full max-w-sm rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-red focus:outline-none"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as "all" | "with" | "missing" | "debit")}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-brand-red/60"
        >
          <option value="all">Alle</option>
          <option value="with">Mit IBAN</option>
          <option value="missing">Ohne IBAN</option>
          <option value="debit">Bankeinzug</option>
        </select>
        <span className="ml-auto text-sm text-gray-500">
          {withIban} / {suppliers.length} mit IBAN · {withDebit} Bankeinzug
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50">
            <tr className="text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3 font-semibold"> </th>
              <th className="px-4 py-3 font-semibold">Lieferant</th>
              <th className="px-4 py-3 font-semibold">IBAN / BIC / Skonto</th>
              <th className="px-4 py-3 font-semibold">Bankeinzug</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">
                  Keine Lieferanten gefunden.
                </td>
              </tr>
            ) : (
              filtered.map((s) => <SupplierRow key={s.customerId} item={s} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
