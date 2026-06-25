import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getPendingBankList } from "@/app/dashboard/belege/bank-import";
import KontoauszugClient from "@/components/KontoauszugClient";

export default async function KontoauszugPage() {
  if (!(await getSession())) redirect("/login");

  const initial = await getPendingBankList();

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Kontoauszug einlesen</h1>
          <p className="mt-1 text-sm text-gray-600">
            Auszug hochladen (PDF/CSV/XLSX) → Abgänge kommen in die Liste und werden den offenen
            Belegen zugeordnet. Beim Speichern verschwinden die zugeordneten Buchungen; offene bleiben
            (auch über mehrere Auszüge hinweg).
          </p>
        </div>
        <Link
          href="/dashboard/belege"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
        >
          ← Zu den Belegen
        </Link>
      </header>

      <KontoauszugClient initial={initial} />
    </div>
  );
}
