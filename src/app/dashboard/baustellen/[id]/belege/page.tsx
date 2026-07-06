import { notFound } from "next/navigation";
import { getBaustelle } from "@/lib/baustellen-docs";
import {
  listBaustellenBelege,
  getBaustellenBelegeStats,
  type BaustellenBeleg,
  type BaustellenBelegeStats,
} from "@/lib/baustellen-belege";
import BaustellenBelege from "@/components/BaustellenBelege";
import BaustellenBelegeStatsView from "@/components/BaustellenBelegeStats";

export default async function BaustelleBelegePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const bid = Number(id);
  const baustelle = Number.isFinite(bid) ? await getBaustelle(bid) : null;
  if (!baustelle) notFound();

  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim() ?? "";

  let belege: BaustellenBeleg[] = [];
  let stats: BaustellenBelegeStats = { count: 0, total: 0, paidTotal: 0, openTotal: 0, bySupplier: [] };
  try {
    [belege, stats] = await Promise.all([
      listBaustellenBelege(baustelle.id, q),
      getBaustellenBelegeStats(baustelle.id),
    ]);
  } catch {
    // optional – ohne Belege bleibt der Bereich leer.
  }

  return (
    <div className="flex w-full max-w-none flex-1 flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">{baustelle.label} · Belege</h1>
        <p className="mt-1 text-sm text-gray-600">
          Eigene Belege dieser Baustelle mit Volltext-OCR – getrennt von HERO und den normalen Belegen.
        </p>
      </header>

      <BaustellenBelegeStatsView stats={stats} />
      <BaustellenBelege baustelleId={baustelle.id} belege={belege} query={q} />
    </div>
  );
}
