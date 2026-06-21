import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listRolesWithUserCount, getAllRolePermissions } from "@/lib/role-store";
import { MODULES } from "@/lib/modules";
import GroupAdmin from "@/components/GroupAdmin";
import PermissionsMatrix from "@/components/PermissionsMatrix";

export default async function GruppenPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (session.role !== "administrator") {
    return (
      <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
        <header>
          <h1 className="text-2xl font-semibold text-gray-900">Benutzergruppen</h1>
        </header>
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          Kein Zugriff – nur für Administratoren.
        </div>
      </div>
    );
  }

  let groups: Awaited<ReturnType<typeof listRolesWithUserCount>> = [];
  let permissions: Record<string, string[]> = {};
  let error: string | null = null;
  try {
    [groups, permissions] = await Promise.all([
      listRolesWithUserCount(),
      getAllRolePermissions(),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Gruppen konnten nicht geladen werden.";
  }

  const nonAdminRoles = groups
    .filter((g) => g.key !== "administrator")
    .map((g) => ({ key: g.key, label: g.label }));

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Benutzergruppen</h1>
        <p className="mt-1 text-sm text-gray-600">Gruppen (Rollen) anlegen und verwalten.</p>
      </header>

      {error ? (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : (
        <>
          <GroupAdmin groups={groups} />
          <PermissionsMatrix
            roles={nonAdminRoles}
            modules={MODULES}
            permissions={permissions}
          />
        </>
      )}
    </div>
  );
}
