import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listOrderList, type OrderItem } from "@/lib/order-list";
import OrderListClient from "@/components/OrderListClient";

export default async function BestelllistePage() {
  if (!(await getSession())) redirect("/login");

  let items: OrderItem[] = [];
  try {
    items = await listOrderList();
  } catch {
    items = [];
  }

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Bestellliste</h1>
        <p className="mt-1 text-sm text-gray-600">
          Was aktuell bestellt werden soll – nach Lieferant gruppiert (wo am günstigsten). Artikel
          kommen über den Preisvergleich hinzu.
        </p>
      </header>

      <OrderListClient items={items} />
    </div>
  );
}
