"use client";

import { useActionState } from "react";
import {
  createGroupAction,
  deleteGroupAction,
  type GroupState,
} from "@/app/dashboard/gruppen/actions";
import type { RoleWithCount } from "@/lib/role-store";

export default function GroupAdmin({ groups }: { groups: RoleWithCount[] }) {
  const [state, formAction, pending] = useActionState<GroupState, FormData>(createGroupAction, {});

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Neue Gruppe anlegen</h2>
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[14rem]">
            <label className="mb-1 block text-sm text-gray-600">Gruppenname *</label>
            <input
              name="label"
              type="text"
              required
              placeholder="z. B. Lager-Team"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Wird angelegt …" : "Gruppe anlegen"}
          </button>
          {state.error && <span className="text-sm text-rose-600">{state.error}</span>}
          {state.success && <span className="text-sm text-emerald-700">{state.success}</span>}
        </form>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-2 font-semibold">Gruppe</th>
              <th className="px-4 py-2 font-semibold">Schlüssel</th>
              <th className="px-4 py-2 text-right font-semibold">Benutzer</th>
              <th className="px-4 py-2 text-right font-semibold">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key} className="border-t border-gray-100">
                <td className="px-4 py-2 font-medium text-gray-900">{g.label}</td>
                <td className="px-4 py-2 text-gray-500">{g.key}</td>
                <td className="px-4 py-2 text-right text-gray-700">{g.userCount}</td>
                <td className="px-4 py-2 text-right">
                  {g.key === "administrator" ? (
                    <span className="text-xs text-gray-400">geschützt</span>
                  ) : g.userCount > 0 ? (
                    <span className="text-xs text-gray-400">zugewiesen</span>
                  ) : (
                    <form action={deleteGroupAction} className="inline">
                      <input type="hidden" name="key" value={g.key} />
                      <button
                        type="submit"
                        className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-brand-red"
                      >
                        Löschen
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
