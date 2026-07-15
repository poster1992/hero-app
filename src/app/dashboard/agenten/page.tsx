import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getSetting,
  DAILY_REPORT_RECIPIENTS_KEY,
  DAILY_REPORT_LOGBOOK_KEYWORDS_KEY,
  DAILY_REPORT_INSTRUCTIONS_KEY,
  DAILY_REPORT_LAST_SENT_KEY,
} from "@/lib/settings";
import { getDailyReportConfig } from "@/lib/daily-report";
import { listWorkflows } from "@/lib/workflows";
import AgentsPanel, { type DailyReportUiConfig } from "@/components/AgentsPanel";

export default async function AgentenPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "administrator") {
    return (
      <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
        <h1 className="text-2xl font-semibold text-gray-900">Agenten</h1>
        <p className="text-sm text-gray-500">Nur für Administratoren.</p>
      </div>
    );
  }

  let dailyReport: DailyReportUiConfig | null = null;
  let workflowCount = 0;
  try {
    const [cfg, recips, keywords, instructions, lastSent, workflows] = await Promise.all([
      getDailyReportConfig(),
      getSetting(DAILY_REPORT_RECIPIENTS_KEY),
      getSetting(DAILY_REPORT_LOGBOOK_KEYWORDS_KEY),
      getSetting(DAILY_REPORT_INSTRUCTIONS_KEY),
      getSetting(DAILY_REPORT_LAST_SENT_KEY),
      listWorkflows().catch(() => []),
    ]);
    workflowCount = workflows.filter((w) => w.active).length;
    dailyReport = {
      enabled: cfg.enabled,
      hour: cfg.hour,
      sendWhenEmpty: cfg.sendWhenEmpty,
      recipients: recips ?? "",
      overrunThreshold: cfg.overrunThreshold,
      checks: cfg.checks,
      logbookKeywords: keywords ?? "",
      instructions: instructions ?? "",
      lastSent: lastSent ?? null,
    };
  } catch {
    /* ohne Werte wird das Panel nicht gerendert */
  }
  const kiConfigured = !!process.env.ANTHROPIC_API_KEY;

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      {dailyReport ? (
        <AgentsPanel dailyReport={dailyReport} workflowCount={workflowCount} kiConfigured={kiConfigured} />
      ) : (
        <>
          <h1 className="text-2xl font-semibold text-gray-900">Agenten</h1>
          <p className="text-sm text-gray-500">Konfiguration konnte nicht geladen werden.</p>
        </>
      )}
    </div>
  );
}
