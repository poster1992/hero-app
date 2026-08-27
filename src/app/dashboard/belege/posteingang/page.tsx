import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getAllowedModules } from "@/lib/role-store";
import BelegInbox from "@/components/BelegInbox";

export default async function BelegPosteingangPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const user = await getUserByUsername(session.username);
  if (!user) redirect("/login");
  const allowed = await getAllowedModules(user.role);
  const canFull = allowed.includes("cockpit_belege");
  // Zugriff: voller Belege-Zugriff ODER das reine Upload-Recht.
  if (!canFull && !allowed.includes("cockpit_belege_upload")) redirect("/dashboard");

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-6 px-6 py-8">
      <header className="border-b-2 border-brand-red pb-2.5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Beleg-Posteingang</h1>
          <p className="mt-1 text-sm text-gray-600">
            Mehrere Belege auf einmal ablegen – sie werden automatisch erkannt und als manuelle Belege erfasst.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/anleitung-belege-hochladen.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
          >
            📄 Anleitung
          </a>
          {canFull && (
            <Link
              href="/dashboard/belege"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
            >
              ← Zu den Belegen
            </Link>
          )}
        </div>
      </header>

      <BelegInbox />
    </div>
  );
}
