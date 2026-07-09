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
  if (!allowed.includes("cockpit_belege")) redirect("/dashboard/belege");

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Beleg-Posteingang</h1>
          <p className="mt-1 text-sm text-gray-600">
            Mehrere Belege auf einmal ablegen – sie werden automatisch erkannt und als manuelle Belege erfasst.
          </p>
        </div>
        <Link
          href="/dashboard/belege"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
        >
          ← Zu den Belegen
        </Link>
      </header>

      <BelegInbox />
    </div>
  );
}
