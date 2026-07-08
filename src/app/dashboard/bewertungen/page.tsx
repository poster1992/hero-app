import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getUserByUsername, listUsers } from "@/lib/users";
import { getAllowedModules } from "@/lib/role-store";
import { getCustomers } from "@/lib/hero-api";
import {
  getReviewSentLookup,
  listReviewEmailHistory,
} from "@/lib/review-emails";
import ReviewCustomersTable, {
  type ReviewCustomerRow,
  type ReviewHistoryDisplay,
} from "@/components/ReviewCustomersTable";

export default async function BewertungenPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const user = await getUserByUsername(session.username);
  if (!user) redirect("/login");
  const allowed = await getAllowedModules(user.role);
  if (!allowed.includes("cockpit_bewertungen")) redirect("/dashboard");

  let rows: ReviewCustomerRow[] = [];
  let history: ReviewHistoryDisplay[] = [];
  let error: string | null = null;

  try {
    const [customers, lookup, hist, users] = await Promise.all([
      getCustomers(),
      getReviewSentLookup(),
      listReviewEmailHistory(),
      listUsers().catch(() => []),
    ]);

    const userName = new Map<number, string>(
      users.map((u) => [u.id, u.displayName || u.username])
    );

    rows = customers
      .filter((c) => (c.email ?? "").trim())
      .map((c) => {
        const byId = lookup.byCustomerId.get(String(c.id));
        const byMail = c.email ? lookup.byEmail.get(c.email.trim().toLowerCase()) : undefined;
        const info = byId ?? byMail;
        return {
          id: c.id,
          name: c.name,
          companyName: c.companyName,
          email: c.email,
          city: c.city,
          categoryName: c.categoryName,
          alreadySent: !!info,
          sentAt: info?.sentAt ?? null,
        };
      });

    history = hist.map((h) => ({
      name: h.customerName,
      email: h.email,
      sentAt: h.sentAt,
      sentBy: h.sentBy != null ? userName.get(h.sentBy) ?? null : null,
    }));
  } catch (e) {
    error = e instanceof Error ? e.message : "Unbekannter Fehler beim Laden der Daten.";
  }

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Kundenbewertungen</h1>
        <p className="mt-1 text-sm text-gray-600">
          Google-Bewertungs-Anfragen an Kunden versenden. Jeder Kunde erhält nur einmal eine
          Anfrage – bereits kontaktierte Kunden sind markiert und werden beim Sammelversand
          automatisch übersprungen.
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-700">
          Fehler beim Laden der Daten: {error}
        </div>
      )}

      {!error && <ReviewCustomersTable rows={rows} history={history} />}
    </div>
  );
}
