"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  uploadStatementAction,
  undoLastStatementUploadAction,
  addStatementMarkerAction,
  deleteStatementMarkerAction,
} from "@/app/dashboard/belege/kontoauszug/actions";
import type { StatementUpload, StatementMarker } from "@/lib/kontoauszuege";
import { MARKER_COLORS, markerColorHex, type MarkerColor } from "@/lib/kontoauszug-colors";

function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function KontoauszugClient({
  initialUploads,
  initialMarkers,
  initialPageCount,
}: {
  initialUploads: StatementUpload[];
  initialMarkers: StatementMarker[];
  initialPageCount: number;
}) {
  const router = useRouter();
  const [viewPage, setViewPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [uploadBusy, startUpload] = useTransition();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [undoBusy, startUndo] = useTransition();
  const [markerBusy, startMarker] = useTransition();
  const [markerError, setMarkerError] = useState<string | null>(null);
  const [markerPage, setMarkerPage] = useState("1");
  const [markerNote, setMarkerNote] = useState("");
  const [markerColor, setMarkerColor] = useState<MarkerColor>("red");
  const [search, setSearch] = useState("");
  const [colorFilter, setColorFilter] = useState<MarkerColor | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasFile = initialPageCount > 0;
  const lastUpload = initialUploads[0] ?? null;

  const filteredMarkers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initialMarkers.filter(
      (m) => (!q || m.note.toLowerCase().includes(q)) && (!colorFilter || m.color === colorFilter)
    );
  }, [initialMarkers, search, colorFilter]);

  const goToPage = (p: number) => {
    const clamped = Math.max(1, Math.min(p, initialPageCount || p));
    setViewPage(clamped);
    setPageInput(String(clamped));
    setMarkerPage(String(clamped));
  };

  const handleUpload = () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setUploadError("Bitte zuerst eine PDF-Datei auswählen.");
      return;
    }
    setUploadError(null);
    startUpload(async () => {
      const fd = new FormData();
      fd.set("file", file);
      const res = await uploadStatementAction(fd);
      if (res.ok) {
        if (fileInputRef.current) fileInputRef.current.value = "";
        router.refresh();
      } else {
        setUploadError(res.error ?? "Anhängen fehlgeschlagen.");
      }
    });
  };

  const handleUndo = () => {
    if (!lastUpload) return;
    if (
      !window.confirm(
        `Zuletzt angehängte Datei „${lastUpload.filename ?? "unbenannt"}" (${lastUpload.pageCount} Seite(n)) wieder entfernen? Markierungen auf diesen Seiten gehen dabei verloren.`
      )
    )
      return;
    startUndo(async () => {
      await undoLastStatementUploadAction();
      router.refresh();
    });
  };

  const handleAddMarker = () => {
    const page = Number(markerPage);
    if (!Number.isFinite(page) || page < 1) {
      setMarkerError("Bitte eine gültige Seitenzahl angeben.");
      return;
    }
    if (!markerNote.trim()) {
      setMarkerError("Bitte eine Notiz eingeben.");
      return;
    }
    setMarkerError(null);
    startMarker(async () => {
      const fd = new FormData();
      fd.set("page", String(page));
      fd.set("note", markerNote);
      fd.set("color", markerColor);
      const res = await addStatementMarkerAction(fd);
      if (res.ok) {
        setMarkerNote("");
        router.refresh();
      } else {
        setMarkerError(res.error ?? "Markierung fehlgeschlagen.");
      }
    });
  };

  const handleDeleteMarker = (id: number) => {
    if (!window.confirm("Diese Markierung löschen?")) return;
    startMarker(async () => {
      await deleteStatementMarkerAction(id);
      router.refresh();
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
      {/* Links: PDF-Vorschau */}
      <div className="flex min-h-[70vh] flex-1 flex-col gap-2 md:min-h-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {hasFile ? `${initialPageCount} Seite(n) gesamt` : "Noch keine Datei"}
          </span>
          {hasFile && (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                goToPage(Number(pageInput) || 1);
              }}
            >
              <span className="text-xs text-gray-500">Gehe zu Seite:</span>
              <input
                type="number"
                min={1}
                max={initialPageCount}
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                className="w-16 border border-line px-1.5 py-0.5 text-xs outline-none focus:border-brand-red/60"
              />
              <button
                type="submit"
                className="rounded border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Los
              </button>
            </form>
          )}
        </div>
        <div className="min-h-0 flex-1 border border-line bg-gray-100">
          {hasFile ? (
            <iframe
              key={`${initialPageCount}-${viewPage}`}
              src={`/api/kontoauszug-datei?v=${initialPageCount}#page=${viewPage}`}
              title="Kontoauszüge"
              className="h-full min-h-[70vh] w-full md:min-h-0"
            />
          ) : (
            <div className="flex h-full min-h-[40vh] items-center justify-center p-6 text-center text-sm text-gray-500">
              Noch keine Kontoauszüge hochgeladen. Lade rechts die erste PDF-Datei hoch.
            </div>
          )}
        </div>
      </div>

      {/* Rechts: Hochladen, Historie, Markierungen (einklappbar für mehr Platz für die PDF-Ansicht) */}
      <div className={`flex flex-col ${sidebarOpen ? "w-full gap-5 md:w-[380px] md:flex-none" : "w-full md:w-auto md:flex-none"}`}>
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? "Bereich einklappen" : "Bereich ausklappen"}
          className="self-start rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:border-brand-red/50 hover:text-gray-900 md:self-end"
        >
          {sidebarOpen ? "» Einklappen" : "« Anhängen/Markierungen"}
        </button>
        {sidebarOpen && (
        <>
        <div className="border border-line bg-gray-50 p-3">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Neue Datei anhängen</h2>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="mb-2 block w-full text-xs"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploadBusy}
              className="rounded-md bg-brand-red px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {uploadBusy ? "Wird angehängt …" : "Anhängen"}
            </button>
            {lastUpload && (
              <button
                type="button"
                onClick={handleUndo}
                disabled={undoBusy}
                className="rounded-md border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-50"
                title="Zuletzt angehängte Datei wieder entfernen"
              >
                {undoBusy ? "…" : "Letzte rückgängig"}
              </button>
            )}
          </div>
          {uploadError && <p className="mt-2 text-xs text-rose-600">{uploadError}</p>}
        </div>

        <div className="border border-line bg-gray-50 p-3">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Bisher angehängt</h2>
          {initialUploads.length === 0 ? (
            <p className="text-xs text-gray-500">Noch keine Datei angehängt.</p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
              {initialUploads.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => goToPage(u.pageStart)}
                    className="min-w-0 flex-1 truncate text-left text-gray-700 hover:text-brand-red"
                    title={u.filename ?? undefined}
                  >
                    {u.filename ?? "unbenannt"}
                  </button>
                  <span className="shrink-0 text-gray-400">
                    S. {u.pageStart}
                    {u.pageCount > 1 ? `–${u.pageStart + u.pageCount - 1}` : ""} · {fmtDateTime(u.addedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col border border-line bg-gray-50 p-3">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Markierung hinzufügen</h2>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-xs text-gray-600">
              Seite
              <input
                type="number"
                min={1}
                value={markerPage}
                onChange={(e) => setMarkerPage(e.target.value)}
                className="mt-0.5 w-16 border border-line px-1.5 py-1 text-xs outline-none focus:border-brand-red/60"
              />
            </label>
            <input
              type="text"
              value={markerNote}
              onChange={(e) => setMarkerNote(e.target.value)}
              placeholder="Notiz, z. B. AXA-Abbuchung prüfen"
              className="min-w-0 flex-1 border border-line px-2 py-1 text-xs outline-none focus:border-brand-red/60"
            />
            <button
              type="button"
              onClick={handleAddMarker}
              disabled={markerBusy}
              className="rounded-md bg-brand-red px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Markieren
            </button>
          </div>
          <div className="mb-3 flex items-center gap-1.5">
            <span className="text-xs text-gray-500">Farbe:</span>
            {MARKER_COLORS.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setMarkerColor(c.key)}
                title={c.label}
                style={{ backgroundColor: c.hex }}
                className={`h-5 w-5 rounded-full border-2 ${
                  markerColor === c.key ? "border-gray-900" : "border-transparent"
                }`}
              />
            ))}
          </div>
          {markerError && <p className="mb-2 text-xs text-rose-600">{markerError}</p>}

          <h2 className="mb-2 text-sm font-semibold text-gray-900">
            Markierungen ({filteredMarkers.length}/{initialMarkers.length})
          </h2>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Markierungen durchsuchen …"
            className="mb-2 w-full border border-line px-2 py-1 text-xs outline-none focus:border-brand-red/60"
          />
          <div className="mb-2 flex items-center gap-1.5">
            <span className="text-xs text-gray-500">Filter:</span>
            {MARKER_COLORS.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setColorFilter((cur) => (cur === c.key ? null : c.key))}
                title={c.label}
                style={{ backgroundColor: c.hex }}
                className={`h-5 w-5 rounded-full border-2 ${
                  colorFilter === c.key ? "border-gray-900" : "border-transparent opacity-60"
                }`}
              />
            ))}
            {colorFilter && (
              <button
                type="button"
                onClick={() => setColorFilter(null)}
                className="text-[10px] text-gray-400 hover:text-gray-700"
              >
                zurücksetzen
              </button>
            )}
          </div>
          <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
            {filteredMarkers.length === 0 ? (
              <li className="text-xs text-gray-500">
                {search || colorFilter ? "Keine Treffer." : "Noch keine Markierungen."}
              </li>
            ) : (
              filteredMarkers.map((m) => (
                <li
                  key={m.id}
                  style={{ borderLeftColor: markerColorHex(m.color), borderLeftWidth: 4 }}
                  className="flex items-start justify-between gap-2 border border-line bg-white p-2 text-xs"
                >
                  <button type="button" onClick={() => goToPage(m.page)} className="min-w-0 flex-1 text-left">
                    <div className="font-semibold text-brand-red">Seite {m.page}</div>
                    <div className="whitespace-pre-line text-gray-700">{m.note}</div>
                    <div className="mt-0.5 text-[10px] text-gray-400">
                      {m.createdByName ? `${m.createdByName} · ` : ""}
                      {fmtDateTime(m.createdAt)}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteMarker(m.id)}
                    className="shrink-0 text-gray-400 transition-colors hover:text-rose-600"
                    title="Markierung löschen"
                  >
                    ✕
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
