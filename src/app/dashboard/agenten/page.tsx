import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getSetting,
  DAILY_REPORT_RECIPIENTS_KEY,
  DAILY_REPORT_LOGBOOK_KEYWORDS_KEY,
  DAILY_REPORT_INSTRUCTIONS_KEY,
  DAILY_REPORT_LAST_SENT_KEY,
  TASK_DIGEST_LAST_SENT_KEY,
  getOutlookAgentConfig,
} from "@/lib/settings";
import { getDailyReportConfig } from "@/lib/daily-report";
import { getTaskDigestConfig } from "@/lib/task-digest";
import { listWorkflows } from "@/lib/workflows";
import { listUsers } from "@/lib/users";
import AgentsPanel, {
  type DailyReportUiConfig,
  type TaskDigestUiConfig,
  type OutlookAgentUiConfig,
} from "@/components/AgentsPanel";

export default async function AgentenPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "administrator") {
    return (
      <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Agenten</h1>
        <p className="text-sm text-gray-500">Nur für Administratoren.</p>
      </div>
    );
  }

  let dailyReport: DailyReportUiConfig | null = null;
  let taskDigest: TaskDigestUiConfig | null = null;
  let outlookAgent: OutlookAgentUiConfig | null = null;
  let outlookUsers: { id: number; name: string }[] = [];
  let workflowCount = 0;
  try {
    const [cfg, recips, keywords, instructions, lastSent, digestCfg, digestLastSent, workflows, outlookCfg, users] =
      await Promise.all([
        getDailyReportConfig(),
        getSetting(DAILY_REPORT_RECIPIENTS_KEY),
        getSetting(DAILY_REPORT_LOGBOOK_KEYWORDS_KEY),
        getSetting(DAILY_REPORT_INSTRUCTIONS_KEY),
        getSetting(DAILY_REPORT_LAST_SENT_KEY),
        getTaskDigestConfig(),
        getSetting(TASK_DIGEST_LAST_SENT_KEY),
        listWorkflows().catch(() => []),
        getOutlookAgentConfig(),
        listUsers().catch(() => []),
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
    taskDigest = {
      enabled: digestCfg.enabled,
      hour: digestCfg.hour,
      lastSent: digestLastSent ?? null,
    };
    outlookAgent = {
      enabled: outlookCfg.enabled,
      tenantId: outlookCfg.tenantId ?? "",
      clientId: outlookCfg.clientId ?? "",
      hasSecret: !!outlookCfg.clientSecret,
      mailbox: outlookCfg.mailbox ?? "",
      keywords: outlookCfg.keywords.join(", "),
      uploadUserId: outlookCfg.uploadUserId,
      lastRun: outlookCfg.lastRun,
      lastImported: outlookCfg.lastImported,
      lastError: outlookCfg.lastError,
    };
    outlookUsers = users
      .filter((u) => u.isActive)
      .map((u) => ({ id: u.id, name: u.displayName || u.username }));
  } catch {
    /* ohne Werte wird das Panel nicht gerendert */
  }
  const kiConfigured = !!process.env.ANTHROPIC_API_KEY;

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      {dailyReport && taskDigest && outlookAgent ? (
        <AgentsPanel
          dailyReport={dailyReport}
          taskDigest={taskDigest}
          outlookAgent={outlookAgent}
          outlookUsers={outlookUsers}
          workflowCount={workflowCount}
          kiConfigured={kiConfigured}
        />
      ) : (
        <>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Agenten</h1>
          <p className="text-sm text-gray-500">Konfiguration konnte nicht geladen werden.</p>
        </>
      )}
    </div>
  );
}
