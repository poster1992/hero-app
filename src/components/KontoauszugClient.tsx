"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  uploadStatementAction,
  undoLastStatementUploadAction,
  addStatementMarkerAction,
  deleteStatementMarkerAction,
  addStampAction,
  deleteStampAction,
  autoDetectLinesAction,
  backfillReceiptPaymentEffectsAction,
} from "@/app/dashboard/belege/kontoauszug/actions";
import type { StatementUpload, StatementMarker, StatementStamp } from "@/lib/kontoauszuege";
import { MARKER_COLORS, markerColorHex, type MarkerColor } from "@/lib/kontoauszug-colors";
import { detectLinesOnPage, type DetectedLine, type MinimalTextItem } from "@/lib/kontoauszug-line-detect";
import LineAssignPanel from "@/components/LineAssignPanel";

function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function KontoauszugClient({
  initialUploads,
  initialMarkers,
  initialStamps,
  initialPageCount,
}: {
  initialUploads: StatementUpload[];
  initialMarkers: StatementMarker[];
  initialStamps: StatementStamp[];
  initialPageCount: number;
}) {
  const router = useRouter();
  const [stampBusy, startStamp] = useTransition();
  const [activePage, setActivePage] = useState(1);
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
  // Erzwingt ein Neuladen des PDF-iframes (die Sammel-Datei ändert sich serverseitig
  // z. B. beim Markieren, ohne dass sich Seitenzahl/URL sonst ändern würde).
  const [reloadToken, setReloadToken] = useState(0);
  // URL-Fragment für den iframe: nur die Seite, oder (falls die Markierung mit
  // einer Textmarker-Position verknüpft ist) zusätzlich zoom=100,left,top, damit
  // direkt zur markierten Stelle statt nur zum Seitenanfang gesprungen wird.
  const [viewFragment, setViewFragment] = useState("page=1");
  // Erzwingt ein erneutes Springen im iframe, auch wenn dieselbe Stelle nochmal angeklickt wird.
  const [jumpToken, setJumpToken] = useState(0);
  // Textmarker-ID, die gerade blau umrandet angezeigt werden soll (per Marker-Klick gesetzt).
  const [selectedHighlightId, setSelectedHighlightId] = useState<number | null>(null);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetectProgress, setAutoDetectProgress] = useState("");
  const [autoDetectError, setAutoDetectError] = useState<string | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null);
  // Filter "Gehe zu Seite" auf geprüfte/ungeprüfte Seiten (Stempel = geprüft).
  const [pageFilter, setPageFilter] = useState<"all" | "checked" | "unchecked">("all");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const isFirstReload = useRef(true);

  // Bei reiner Datenänderung im Hintergrund (z. B. Beleg zugeordnet, Stempel
  // gesetzt) NICHT die ganze iframe-Quelle wechseln (das lässt den nativen
  // PDF-Viewer den vom Nutzer eingestellten Zoom auf 100 % zurücksetzen,
  // weil er dann wie eine komplett neue Datei wirkt). Stattdessen dieselbe
  // bereits angezeigte Datei an Ort und Stelle neu laden – Seite/Zoom bleiben
  // dabei zuverlässiger erhalten als bei einem kompletten iframe-Neuaufbau.
  useEffect(() => {
    if (isFirstReload.current) {
      isFirstReload.current = false;
      return;
    }
    try {
      iframeRef.current?.contentWindow?.location.reload();
    } catch {
      // Falls der Browser den Zugriff verweigert, bleibt die Ansicht bis zur
      // nächsten gezielten Navigation (Seite/Marker) auf dem alten Stand.
    }
  }, [reloadToken]);

  const hasFile = initialPageCount > 0;
  const lastUpload = initialUploads[0] ?? null;
  const currentStamp = initialStamps.find((s) => s.page === activePage) ?? null;

  // Seiten mit "GEPRÜFT"-Stempel (siehe "📋 Seite stempeln") – für den Geprüft/Ungeprüft-Filter.
  const stampedPages = useMemo(() => new Set(initialStamps.map((s) => s.page)), [initialStamps]);
  const matchesPageFilter = (p: number) =>
    pageFilter === "all" ? true : pageFilter === "checked" ? stampedPages.has(p) : !stampedPages.has(p);
  const checkedCount = stampedPages.size;

  const filteredMarkers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initialMarkers.filter(
      (m) => (!q || m.note.toLowerCase().includes(q)) && (!colorFilter || m.color === colorFilter)
    );
  }, [initialMarkers, search, colorFilter]);

  const goToPage = (
    p: number,
    highlight?: { id: number; x: number; y: number; width: number; height: number } | null
  ) => {
    const clamped = Math.max(1, Math.min(p, initialPageCount || p));
    setActivePage(clamped);
    setPageInput(String(clamped));
    setMarkerPage(String(clamped));
    if (highlight) {
      // PDF-Koordinaten (Ursprung unten links) → etwas Rand über der Markierung,
      // damit sie nicht direkt am oberen Rand klebt.
      const top = Math.round(highlight.y + highlight.height + 40);
      setViewFragment(`page=${clamped}&zoom=100,0,${top}`);
      setSelectedHighlightId(highlight.id);
    } else {
      setViewFragment(`page=${clamped}`);
      setSelectedHighlightId(null);
    }
    setJumpToken((t) => t + 1);
  };

  // Springt von der aktuellen Seite aus zur nächsten/vorherigen Seite, die zum
  // Geprüft/Ungeprüft-Filter passt (für "alle" einfach vor/zurück blättern).
  const jumpToFilteredPage = (direction: 1 | -1) => {
    for (let p = activePage + direction; p >= 1 && p <= initialPageCount; p += direction) {
      if (matchesPageFilter(p)) {
        goToPage(p);
        return;
      }
    }
    window.alert(
      direction === 1
        ? "Keine weitere passende Seite danach gefunden."
        : "Keine passende Seite davor gefunden."
    );
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
        setReloadToken((t) => t + 1);
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
      setReloadToken((t) => t + 1);
      router.refresh();
    });
  };

  const handleToggleStamp = () => {
    startStamp(async () => {
      if (currentStamp) {
        await deleteStampAction(currentStamp.id);
      } else {
        await addStampAction(activePage);
      }
      setReloadToken((t) => t + 1);
      router.refresh();
    });
  };

  // Erkennt automatisch alle Buchungszeilen + Beträge über das GESAMTE Dokument
  // (PDF-Text-Layer, kein Bild-OCR nötig) und legt sie als neue, noch unzugeordnete
  // (rote) Zeilen-Zuordnungen an. Das Zuordnen der Belege bleibt danach manuell
  // (über „Belege zuordnen" je Seite).
  const handleAutoDetectLines = async () => {
    if (!hasFile || autoDetecting) return;
    setAutoDetecting(true);
    setAutoDetectError(null);
    setAutoDetectProgress("Wird vorbereitet …");
    try {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const doc = await pdfjsLib.getDocument({ url: "/api/kontoauszug-datei" }).promise;
      const all: DetectedLine[] = [];
      for (let p = 1; p <= doc.numPages; p++) {
        setAutoDetectProgress(`Seite ${p} von ${doc.numPages} wird analysiert …`);
        const page = await doc.getPage(p);
        const textContent = await page.getTextContent();
        // `items` kann auch TextMarkedContent (ohne `str`) enthalten – nur echte Textelemente nutzen.
        const textItems = textContent.items.filter((it) => typeof (it as { str?: unknown }).str === "string");
        all.push(...detectLinesOnPage(p, textItems as unknown as MinimalTextItem[]));
      }
      setAutoDetectProgress("Wird gespeichert …");
      const res = await autoDetectLinesAction(all);
      if (res.ok) {
        setAutoDetectProgress("");
        setReloadToken((t) => t + 1);
        router.refresh();
        window.alert(
          all.length === 0
            ? "Es wurden keine Beträge im Text der PDF gefunden (evtl. eingescannt, ohne Text-Layer)."
            : `${res.created ?? 0} neue Zeile(n) erkannt und angelegt (${all.length - (res.created ?? 0)} bereits vorhanden/übersprungen).`
        );
      } else {
        setAutoDetectError(res.error ?? "Erkennung fehlgeschlagen.");
      }
    } catch (e) {
      setAutoDetectError(e instanceof Error ? e.message : "Erkennung fehlgeschlagen.");
    } finally {
      setAutoDetecting(false);
      setAutoDetectProgress("");
    }
  };

  // Einmalig nutzbar: holt den Zahlstatus-Abgleich für Beleg-Zuordnungen nach,
  // die VOR dem Umbau auf "sofort je Beleg" angelegt wurden (über alle Seiten
  // hinweg) – betrifft nur Zuordnungen, deren Zahlstatus noch nicht übernommen wurde.
  const handleBackfillPayments = async () => {
    if (backfillBusy) return;
    if (
      !window.confirm(
        "Prüft ALLE bereits zugeordneten Belege (über alle Seiten) und setzt den Zahlstatus nach, falls das beim Zuordnen noch nicht passiert ist. Fortfahren?"
      )
    )
      return;
    setBackfillBusy(true);
    setBackfillMsg(null);
    const res = await backfillReceiptPaymentEffectsAction();
    setBackfillBusy(false);
    if (res.ok) {
      setBackfillMsg(`${res.applied ?? 0} von ${res.checked ?? 0} geprüften Zuordnungen aktualisiert.`);
      setReloadToken((t) => t + 1);
      router.refresh();
    } else {
      setBackfillMsg(res.error ?? "Fehlgeschlagen.");
    }
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
    if (!window.confirm("Diese Markierung löschen? Falls sie mit einer Textmarker-Stelle im PDF verknüpft ist, wird die dort auch entfernt.")) return;
    startMarker(async () => {
      await deleteStatementMarkerAction(id);
      // Falls eine verknüpfte PDF-Markierung mitgelöscht wurde, PDF-Ansicht neu laden.
      setReloadToken((t) => t + 1);
      router.refresh();
    });
  };

  return (
    <>
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
          {hasFile && (
            <div className="flex items-center gap-1">
              <select
                value={pageFilter}
                onChange={(e) => setPageFilter(e.target.value as "all" | "checked" | "unchecked")}
                title="Seiten nach Prüfstatus filtern (Stempel = geprüft)"
                className="rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-700 outline-none focus:border-brand-red/60"
              >
                <option value="all">Alle Seiten</option>
                <option value="checked">✓ Geprüft ({checkedCount})</option>
                <option value="unchecked">Ungeprüft ({initialPageCount - checkedCount})</option>
              </select>
              <button
                type="button"
                onClick={() => jumpToFilteredPage(-1)}
                title="Vorherige passende Seite"
                className="rounded border border-gray-300 px-1.5 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                ◀
              </button>
              <button
                type="button"
                onClick={() => jumpToFilteredPage(1)}
                title="Nächste passende Seite"
                className="rounded border border-gray-300 px-1.5 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                ▶
              </button>
            </div>
          )}
          {hasFile && (
            <button
              type="button"
              onClick={handleToggleStamp}
              disabled={stampBusy}
              title={
                currentStamp
                  ? "Stempel auf dieser Seite entfernen"
                  : "Großen Geprüft-Stempel auf diese Seite setzen"
              }
              className={`rounded border px-2 py-0.5 text-xs font-medium disabled:opacity-50 ${
                currentStamp
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  : "border-gray-300 text-gray-700 hover:border-brand-red/50 hover:bg-gray-50"
              }`}
            >
              {stampBusy ? "…" : currentStamp ? "✓ Geprüft · entfernen" : "📋 Seite stempeln"}
            </button>
          )}
          {hasFile && (
            <button
              type="button"
              onClick={handleAutoDetectLines}
              disabled={autoDetecting}
              title="Alle Buchungszeilen samt Beträgen im gesamten Dokument automatisch erkennen (PDF-Text, kein Bild-OCR). Start als rote, noch unzugeordnete Zeilen."
              className="rounded border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 hover:border-brand-red/50 hover:bg-gray-50 disabled:opacity-50"
            >
              {autoDetecting ? autoDetectProgress || "…" : "🔍 Zeilen automatisch erkennen"}
            </button>
          )}
          {hasFile && (
            <button
              type="button"
              onClick={handleBackfillPayments}
              disabled={backfillBusy}
              title="Für bereits zugeordnete Belege (alle Seiten) nachträglich prüfen, ob der Zahlstatus schon übernommen wurde, und ggf. jetzt setzen."
              className="rounded border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 hover:border-brand-red/50 hover:bg-gray-50 disabled:opacity-50"
            >
              {backfillBusy ? "…" : "🔄 Zahlstatus bestehender Zuordnungen prüfen"}
            </button>
          )}
        </div>
        {autoDetectError && <p className="px-0.5 text-xs text-rose-600">{autoDetectError}</p>}
        {backfillMsg && <p className="px-0.5 text-xs text-gray-600">{backfillMsg}</p>}
        <div className="min-h-0 flex-1 border border-line bg-gray-100">
          {hasFile ? (
            <iframe
              ref={iframeRef}
              key={`${initialPageCount}-${jumpToken}`}
              src={`/api/kontoauszug-datei${
                selectedHighlightId != null ? `?highlight=${selectedHighlightId}` : ""
              }#${viewFragment}`}
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

        {hasFile && (
          <LineAssignPanel
            page={activePage}
            reloadToken={reloadToken}
            onChanged={() => {
              setReloadToken((t) => t + 1);
              router.refresh();
            }}
          />
        )}

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
                  <button
                    type="button"
                    onClick={() => goToPage(m.page, m.highlight)}
                    title={m.highlight ? "Springt direkt zur markierten Stelle" : "Springt zur Seite"}
                    className="min-w-0 flex-1 text-left"
                  >
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
    </>
  );
}
