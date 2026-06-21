"use client";

import { useRouter } from "next/navigation";
import { setPreviewRole } from "@/app/dashboard/preview-actions";

interface RoleOption {
  key: string;
  label: string;
}

export default function RolePreviewSwitcher({
  activeRole,
  roles,
}: {
  activeRole: string;
  roles: RoleOption[];
}) {
  const router = useRouter();

  async function apply(role: string | null) {
    await setPreviewRole(role);
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
      <h2 className="text-lg font-semibold text-gray-900">Ansicht als Gruppe testen</h2>
      <p className="mt-1 text-sm text-gray-600">
        Klicke auf eine Gruppe, um das Menü aus ihrer Sicht zu sehen (was sie sehen kann und was
        nicht). Mit „Administrator“ kehrst du zur vollen Ansicht zurück.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {roles.map((r) => {
          const isActive = activeRole === r.key;
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => apply(r.key === "administrator" ? null : r.key)}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "border-brand-red bg-brand-red text-white"
                  : "border-gray-300 text-gray-700 hover:border-brand-red/50 hover:text-gray-900"
              }`}
            >
              {r.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
