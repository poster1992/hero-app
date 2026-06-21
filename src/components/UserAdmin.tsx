"use client";

import { useActionState } from "react";
import { createUserAction, setActiveAction, type CreateUserState } from "@/app/dashboard/benutzer/actions";
import { ROLES, roleLabel } from "@/lib/roles";
import type { AppUser } from "@/lib/users";

export default function UserAdmin({
  users,
  currentUsername,
}: {
  users: AppUser[];
  currentUsername: string;
}) {
  const [state, formAction, pending] = useActionState<CreateUserState, FormData>(
    createUserAction,
    {}
  );

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60";

  return (
    <div className="flex flex-col gap-6">
      {/* Neuen Benutzer anlegen */}
      <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Neuen Benutzer anlegen</h2>
        <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-gray-600">Benutzername *</label>
            <input name="username" type="text" required className={inputClass} placeholder="z. B. max@floortec.design" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Anzeigename</label>
            <input name="displayName" type="text" className={inputClass} placeholder="Max Mustermann" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">
              E-Mail <span className="text-gray-400">(für Benachrichtigungen)</span>
            </label>
            <input name="email" type="email" className={inputClass} placeholder="max@floortec.design" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Passwort *</label>
            <input name="password" type="text" required className={inputClass} placeholder="Startpasswort" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Rolle *</label>
            <select name="role" required defaultValue="monteur" className={inputClass}>
              {ROLES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2 flex items-center gap-4">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Wird angelegt …" : "Benutzer anlegen"}
            </button>
            {state.error && <span className="text-sm text-rose-600">{state.error}</span>}
            {state.success && <span className="text-sm text-emerald-700">{state.success}</span>}
          </div>
        </form>
      </div>

      {/* Benutzerliste */}
      <div className="overflow-x-auto rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-2 font-semibold">Benutzername</th>
              <th className="px-4 py-2 font-semibold">Name</th>
              <th className="px-4 py-2 font-semibold">E-Mail</th>
              <th className="px-4 py-2 font-semibold">Rolle</th>
              <th className="px-4 py-2 font-semibold">Status</th>
              <th className="px-4 py-2 text-right font-semibold">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-gray-100">
                <td className="px-4 py-2 text-gray-900">{u.username}</td>
                <td className="px-4 py-2 text-gray-600">{u.displayName ?? "—"}</td>
                <td className="px-4 py-2 text-gray-600">{u.email ?? "—"}</td>
                <td className="px-4 py-2 text-gray-600">{roleLabel(u.role)}</td>
                <td className="px-4 py-2">
                  {u.isActive ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      aktiv
                    </span>
                  ) : (
                    <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
                      inaktiv
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  {u.username === currentUsername ? (
                    <span className="text-xs text-gray-400">(du)</span>
                  ) : (
                    <form action={setActiveAction} className="inline">
                      <input type="hidden" name="id" value={u.id} />
                      <input type="hidden" name="active" value={u.isActive ? "0" : "1"} />
                      <button
                        type="submit"
                        className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
                      >
                        {u.isActive ? "Deaktivieren" : "Aktivieren"}
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
