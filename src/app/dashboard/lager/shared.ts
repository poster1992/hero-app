import "server-only";
import {
  getLocalQuantities,
  getLocalEkPrices,
  getLocalMinMax,
  syncArticleMaster,
} from "@/lib/materials";
import { getStockArticles } from "@/lib/hero-api";
import type { LagerItem } from "@/lib/material-types";

/**
 * Lädt die Lager-Artikel inkl. lokaler Bestände, EK-Preise und Min/Max.
 * Gemeinsam genutzt von den Lager-Unterseiten (Ein-/Ausbuchen, Artikelbestandsliste).
 */
export async function loadLagerItems(): Promise<LagerItem[]> {
  const articles = await getStockArticles();
  // EK-Preise + Stammdaten lokal übernehmen (gespeichert, nicht angezeigt).
  await syncArticleMaster(
    articles.map((a) => ({
      id: a.id,
      name: a.name,
      itemNumber: a.itemNumber,
      unit: a.unit,
      purchasePrice: a.purchasePrice,
    }))
  );
  const [localQ, localEk, localMinMax] = await Promise.all([
    getLocalQuantities(),
    getLocalEkPrices(),
    getLocalMinMax(),
  ]);
  return articles.map((a) => {
    const mm = localMinMax.get(a.id);
    return {
      id: a.id,
      name: a.name,
      itemNumber: a.itemNumber,
      qrId: a.qrId,
      unit: a.unit,
      category: a.category,
      quantity: localQ.get(a.id) ?? 0, // lokaler Bestand aus MySQL (HERO-Bestand ignoriert)
      ekPrice: localEk.get(a.id) ?? 0,
      minStock: mm?.min ?? null,
      maxStock: mm?.max ?? null,
    };
  });
}
