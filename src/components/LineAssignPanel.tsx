"use client";

import { useEffect, useState } from "react";
import { listPageLinesAction } from "@/app/dashboard/belege/kontoauszug/actions";
import type { StatementLine } from "@/lib/kontoauszuege";
import LineAssignList from "@/components/LineAssignList";

/**
 * Zeigt die Zeilen-Zuordnungen der aktuell angezeigten Seite direkt in der
 * Seitenleiste (Soll-Betrag, Status, zugeordnete Belege, Beleg suchen +
 * zuordnen/entfernen). Neue Zeilen legt ausschließlich „Zeilen automatisch
 * erkennen" (Toolbar, ganzes Dokument über den PDF-Text-Layer) an – der
 * frühere Button zum manuellen Rechteck-Ziehen (eigenes Fenster) wurde auf
 * Nutzerwunsch entfernt.
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
          Noch keine Zeile auf dieser Seite erkannt. Oben &bdquo;🔍 Zeilen automatisch erkennen&ldquo; nutzen (gesamtes
          Dokument, Text-Layer der PDF).
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <LineAssignList lines={lines} onReload={handleReload} />
        </div>
      )}
    </div>
  );
}
