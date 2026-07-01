import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listAllBelegArticles } from "@/lib/beleg-articles";
import { getReceiptsInRange } from "@/lib/hero-api";
import { getCustomerName } from "@/lib/invoices";
import PriceComparison, { type PriceRow } from "@/components/PriceComparison";

export default async function PreisvergleichPage() {
  if (!(await getSession())) redirect("/login");

  let rows: PriceRow[] = [];
  let error: string | null = null;
  try {
    const now = new Date();
    const [entries, receipts] = await Promise.all([
      listAllBelegArticles(),
      getReceiptsInRange(`${now.getUTCFullYear() - 1}-01-01T00:00:00Z`, `${now.getUTCFullYear() + 1}-12-31T23:59:59Z`),
    ]);
    const recMap = new Map(receipts.map((r) => [r.id, r]));
    for (const e of entries) {
      const r = recMap.get(e.heroReceiptId);
      const supplier = r ? getCustomerName(r) : "—";
      const date = r?.receiptDate ? r.receiptDate.slice(0, 10) : null;
      const number = r?.number ?? "";
      for (const it of e.items) {
        if (!it.name.trim()) continue;
        rows.push({
          article: it.name,
          supplier,
          date,
          number,
          heroReceiptId: e.heroReceiptId,
          quantity: it.quantity,
          unit: it.unit,
          unitPrice: it.unitPrice,
          lineTotal: it.lineTotal,
        });
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Daten konnten nicht geladen werden.";
  }

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Preisvergleich</h1>
        <p className="mt-1 text-sm text-gray-600">
          Artikel-Einkaufspreise aus allen ausgelesenen Belegen – je Artikel ist der günstigste
          Lieferant hervorgehoben.
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      <PriceComparison rows={rows} />
    </div>
  );
}
