import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listUsers } from "@/lib/users";
import UserAdmin from "@/components/UserAdmin";

export default async function BenutzerPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (session.role !== "administrator") {
    return (
      <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
        <header>
          <h1 className="text-2xl font-semibold text-gray-900">Benutzer</h1>
        </header>
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          Kein Zugriff – diese Seite ist nur für Administratoren.
        </div>
      </div>
    );
  }

  let users: Awaited<ReturnType<typeof listUsers>> = [];
  let error: string | null = null;
  try {
    users = await listUsers();
  } catch (e) {
    error = e instanceof Error ? e.message : "Benutzer konnten nicht geladen werden.";
  }

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Benutzer</h1>
        <p className="mt-1 text-sm text-gray-600">Mitarbeiter-Zugänge anlegen und verwalten.</p>
      </header>

      {error ? (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : (
        <UserAdmin users={users} currentUsername={session.username} />
      )}
    </div>
  );
}
