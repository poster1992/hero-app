"use client";

import { useEffect, useState } from "react";
import { listPageLinesAction } from "@/app/dashboard/belege/kontoauszug/actions";
import type { StatementLine } from "@/lib/kontoauszuege";
import LineAssignList from "@/components/LineAssignList";

/**
 * Zeigt die Zeilen-Zuordnungen der aktuell angezeigten Seite direkt in der
 * Seitenleiste (Soll-Betrag, Status, zugeordnete Belege, Beleg suchen +
 * zuordnen/entfernen) – ohne dafür das separate "Belege zuordnen"-Fenster
 * öffnen zu müssen. Neue Zeilen (Rechteck um eine Buchungszeile ziehen)
 * legt weiterhin nur das Fenster bzw. „Zeilen automatisch erkennen" an, da
 * das Ziehen eine eigene Canvas-Darstellung der Seite braucht (die
 * Hauptansicht ist bewusst ein natives iframe, siehe Suche-vs-Scroll-Trade-off).
 */
export default function LineAssignPanel({
  page,
  reloadToken,
  onChanged,
}: {
  page: number;
  /** Erhöht sich, wenn sich die Sammel-Datei von anderswo geändert hat → neu laden. */
  reloadToken: number;
  /** Nach jeder Änderung aufgerufen: Elternkomponente soll die PDF-Vorschau neu laden. */
  onChanged: () => void;
}) {
  const [lines, setLines] = useState<StatementLine[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const list = await listPageLinesAction(page);
    setLines(list);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, reloadToken]);

  const handleReload = async () => {
    await load();
    onChanged();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col border border-line bg-gray-50 p-3">
      <h2 className="mb-2 text-sm font-semibold text-gray-900">
        Belege zuordnen · Seite {page} ({lines.length})
      </h2>
      {loading ? (
        <p className="text-xs text-gray-500">Wird geladen …</p>
      ) : lines.length === 0 ? (
        <p className="text-xs text-gray-500">
          Noch keine Zeile auf dieser Seite markiert. Über &bdquo;🧾 Belege zuordnen&ldquo; oben einen Rahmen um eine
          Buchungszeile ziehen oder &bdquo;🔍 Zeilen automatisch erkennen&ldquo; für das ganze Dokument nutzen.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <LineAssignList lines={lines} onReload={handleReload} />
        </div>
      )}
    </div>
  );
}
