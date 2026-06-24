import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getReceiptsInRange } from "@/lib/hero-api";
import { getCustomerName } from "@/lib/invoices";
import { getSupplierIbanMap } from "@/lib/supplier-ibans";
import SupplierIbanManager, { type SupplierIbanItem } from "@/components/SupplierIbanManager";

export default async function SupplierIbansPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let items: SupplierIbanItem[] = [];
  let error: string | null = null;
  try {
    const now = new Date();
    const from = `${now.getUTCFullYear() - 3}-01-01T00:00:00Z`;
    const to = `${now.getUTCFullYear()}-12-31T23:59:59Z`;
    const [receipts, ibanMap] = await Promise.all([
      getReceiptsInRange(from, to),
      getSupplierIbanMap(),
    ]);

    // Eindeutige Lieferanten aus den Belegen (gleiche Kundennummer wie im Export).
    const byId = new Map<number, string>();
    for (const r of receipts) {
      if (r.type !== "output") continue;
      const id = r.customer?.id;
      if (id == null) continue;
      if (!byId.has(id)) byId.set(id, getCustomerName(r));
    }

    items = [...byId.entries()]
      .map(([customerId, name]) => {
        const stored = ibanMap.get(customerId);
        return {
          customerId,
          name,
          iban: stored?.iban ?? "",
          bic: stored?.bic ?? "",
          directDebit: stored?.directDebit ?? false,
          skontoDays: stored?.skontoDays ?? null,
          skontoPercent: stored?.skontoPercent ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "de"));
  } catch (e) {
    error = e instanceof Error ? e.message : "Daten konnten nicht geladen werden.";
  }

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Lieferanten-IBANs</h1>
          <p className="mt-1 text-sm text-gray-600">
            IBAN/BIC je Lieferant pflegen – wird beim Multiline-SEPA-Export automatisch verwendet.
          </p>
        </div>
        <Link
          href="/dashboard/belege"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
        >
          ← Zu den Belegen
        </Link>
      </header>

      {error ? (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : (
        <SupplierIbanManager suppliers={items} />
      )}
    </div>
  );
}
