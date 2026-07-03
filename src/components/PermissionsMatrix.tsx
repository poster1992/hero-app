"use client";

import { Fragment } from "react";
import { savePermissionsAction } from "@/app/dashboard/gruppen/actions";
import type { AppModule } from "@/lib/modules";

interface RoleOption {
  key: string;
  label: string;
}

export default function PermissionsMatrix({
  roles,
  modules,
  permissions,
}: {
  roles: RoleOption[]; // non-admin roles
  modules: AppModule[];
  permissions: Record<string, string[]>; // roleKey -> module keys
}) {
  if (roles.length === 0) {
    return (
      <div className="rounded-xl border border-gray-300 bg-white p-5 text-sm text-gray-500 shadow-lg shadow-black/10">
        Keine Gruppen vorhanden. Lege oben eine Gruppe an, um Rechte zu vergeben.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
      <h2 className="mb-1 text-lg font-semibold text-gray-900">Rechte je Gruppe</h2>
      <p className="mb-4 text-sm text-gray-600">
        Lege fest, welche Bereiche jede Gruppe im Menü sieht – die Cockpit-Menüpunkte lassen sich
        einzeln freigeben. Administrator hat immer vollen Zugriff.
      </p>

      <form action={savePermissionsAction}>
        <input type="hidden" name="roleKeys" value={roles.map((r) => r.key).join(",")} />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2 font-semibold">Bereich</th>
                {roles.map((r) => (
                  <th key={r.key} className="px-3 py-2 text-center font-semibold">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modules.map((m, i) => {
                const prev = modules[i - 1];
                const showGroupHeader = m.group && m.group !== prev?.group;
                return (
                  <Fragment key={m.key}>
                    {showGroupHeader && (
                      <tr className="border-t border-gray-200 bg-gray-50">
                        <td
                          colSpan={roles.length + 1}
                          className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500"
                        >
                          {m.group}
                        </td>
                      </tr>
                    )}
                    <tr className="border-t border-gray-100">
                      <td className={`px-3 py-2 text-gray-900 ${m.group ? "pl-6" : ""}`}>{m.label}</td>
                      {roles.map((r) => (
                        <td key={r.key} className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            name={`perm__${r.key}__${m.key}`}
                            defaultChecked={permissions[r.key]?.includes(m.key) ?? false}
                            className="h-4 w-4 accent-brand-red"
                          />
                        </td>
                      ))}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4">
          <button
            type="submit"
            className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Rechte speichern
          </button>
        </div>
      </form>
    </div>
  );
}
