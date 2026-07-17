/**
 * Server-Start-Hook (Next.js). Richtet einen serverseitigen Timer ein, der die
 * Workflow-Prüfung – wie der „Jetzt prüfen"-Button – automatisch alle 10 Minuten
 * ausführt. Läuft unabhängig davon, ob ein Browser geöffnet ist.
 */
export async function register(): Promise<void> {
  // Nur im Node-Runtime (nicht Edge) und nur einmal pro Prozess.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as unknown as { __wfCronStarted?: boolean };
  if (g.__wfCronStarted) return;
  g.__wfCronStarted = true;

  const TEN_MINUTES = 10 * 60 * 1000;

  const run = async () => {
    try {
      const { runWorkflowScan } = await import("./lib/workflow-engine");
      const r = await runWorkflowScan(true, "timer");
      if (r.created > 0) {
        console.log(`[workflow-cron] geprüft: ${r.checked}, erstellt: ${r.created}`);
      }
    } catch (e) {
      console.warn("[workflow-cron] Fehler:", e instanceof Error ? e.message : e);
    }
  };

  // Erstlauf kurz nach dem Start (DB/HERO bereit), danach alle 10 Minuten.
  setTimeout(run, 30_000);
  setInterval(run, TEN_MINUTES);
  console.log("[workflow-cron] aktiv – Workflow-Prüfung alle 10 Minuten.");

  // Zweiter, unabhängiger Loop: täglicher Analyse-Bericht (prüft alle 10 Min die
  // Fälligkeit, versendet höchstens einmal pro Kalendertag um die Zielstunde).
  const g2 = globalThis as unknown as { __dailyReportStarted?: boolean };
  if (!g2.__dailyReportStarted) {
    g2.__dailyReportStarted = true;
    const tick = async () => {
      try {
        const { maybeRunDailyReport } = await import("./lib/daily-report");
        await maybeRunDailyReport();
      } catch (e) {
        console.warn("[daily-report] Timer-Fehler:", e instanceof Error ? e.message : e);
      }
    };
    setTimeout(tick, 60_000);
    setInterval(tick, TEN_MINUTES);
    console.log("[daily-report] aktiv – tägliche Prüfung alle 10 Minuten.");
  }

  // Dritter Loop: Volltext-Indexierung manueller Belege automatisch nachziehen.
  // Deckt Belege ab, die NICHT über den Posteingang kamen (Formular-Uploads,
  // Altbestand) – so muss niemand mehr manuell „Volltext indexieren" klicken.
  // Verarbeitet je Lauf einen kleinen Block; ohne offene Belege kein KI-Aufruf.
  const g3 = globalThis as unknown as { __manualOcrStarted?: boolean };
  if (!g3.__manualOcrStarted) {
    g3.__manualOcrStarted = true;
    const tickOcr = async () => {
      try {
        const { runManualOcrBackfillCore } = await import("./lib/manual-ocr-core");
        const r = await runManualOcrBackfillCore();
        if (r.processed > 0) {
          console.log(`[manual-ocr] Volltext indexiert: ${r.processed}, offen: ${r.remaining}`);
        }
      } catch (e) {
        console.warn("[manual-ocr] Fehler:", e instanceof Error ? e.message : e);
      }
    };
    setTimeout(tickOcr, 90_000);
    setInterval(tickOcr, TEN_MINUTES);
    console.log("[manual-ocr] aktiv – Volltext-Backfill alle 10 Minuten.");
  }
}
