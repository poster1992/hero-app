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
      const r = await runWorkflowScan(true);
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
}
