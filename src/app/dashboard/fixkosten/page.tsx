import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getAllowedModules } from "@/lib/role-store";
import { listFixkosten, getFixkostenHistory, type FixkostenItem, type FixkostenHistory } from "@/lib/fixkosten";
import { getBookAccounts, type BookAccount } from "@/lib/hero-api";
import FixkostenClient from "@/components/FixkostenClient";
import FixkostenHistoryTable from "@/components/FixkostenHistoryTable";
import YearSelector from "@/components/YearSelector";

const BASE_PATH = "/dashboard/fixkosten";

export default async function FixkostenPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const user = await getUserByUsername(session.username);
  if (!user) redirect("/login");
  const allowed = await getAllowedModules(user.role);
  if (!allowed.includes("cockpit_fixkosten")) redirect("/dashboard");

  const params = await searchParams;
  const yearParam = Array.isArray(params.year) ? params.year[0] : params.year;
  const currentYear = new Date().getUTCFullYear();
  const parsedYear = yearParam ? parseInt(yearParam, 10) : currentYear;
  const year = Number.isFinite(parsedYear) ? parsedYear : currentYear;

  let items: FixkostenItem[] = [];
  let error: string | null = null;
  try {
    items = await listFixkosten();
  } catch (e) {
    error = e instanceof Error ? e.message : "Daten konnten nicht geladen werden.";
  }

  // Für die Konto-Zuordnung (GuV-Konten) – bei HERO-Fehlern einfach leere Liste,
  // blockiert nicht die restliche Fixkosten-Seite.
  const accounts: BookAccount[] = await getBookAccounts().catch(() => []);

  let history: FixkostenHistory = { rows: [], totalMonthly: new Array(12).fill(0), months: [] };
  try {
    history = await getFixkostenHistory(year);
  } catch {
    /* Verlauf optional – Hauptliste funktioniert auch ohne. */
  }

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-4 py-8">
      <header className="border-b-2 border-brand-red pb-2.5">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Fixkosten</h1>
        <p className="mt-1 text-sm text-gray-600">
          Wiederkehrende monatliche Fixkosten erfassen (z. B. Miete, Versicherungen, Abos) und die Summe im Blick
          behalten.
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-700">{error}</div>
      ) : (
        <FixkostenClient items={items} accounts={accounts} />
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-2">
          <h2 className="text-lg font-bold text-ink">Verlauf</h2>
          <YearSelector year={year} basePath={BASE_PATH} />
        </div>
        <FixkostenHistoryTable history={history} year={year} />
      </section>
    </div>
  );
}
