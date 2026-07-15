import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getSetting,
  GOOGLE_REVIEW_URL_KEY,
  SMTP_HOST_KEY,
  SMTP_PORT_KEY,
  SMTP_USER_KEY,
  SMTP_PASS_KEY,
  SMTP_FROM_KEY,
  GOOGLE_PLACES_API_KEY_KEY,
  GOOGLE_PLACE_ID_KEY,
  DAILY_REPORT_RECIPIENTS_KEY,
  DAILY_REPORT_LOGBOOK_KEYWORDS_KEY,
  DAILY_REPORT_INSTRUCTIONS_KEY,
  DAILY_REPORT_LAST_SENT_KEY,
} from "@/lib/settings";
import SettingsForm from "@/components/SettingsForm";
import BaustellenAdmin from "@/components/BaustellenAdmin";
import AgentsPanel, { type DailyReportUiConfig } from "@/components/AgentsPanel";
import { getDailyReportConfig } from "@/lib/daily-report";
import { listWorkflows } from "@/lib/workflows";
import { listBaustellen, type BaustelleDoc } from "@/lib/baustellen-docs";

export default async function EinstellungenPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "administrator") {
    return (
      <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
        <h1 className="text-2xl font-semibold text-gray-900">Einstellungen</h1>
        <p className="text-sm text-gray-500">Nur für Administratoren.</p>
      </div>
    );
  }

  let googleReviewUrl = "";
  const smtp = { host: "", port: "587", user: "", from: "", passSet: false };
  const places = { placeId: "", apiKeySet: false };
  try {
    const [g, host, port, user, from, pass, placeId, apiKey] = await Promise.all([
      getSetting(GOOGLE_REVIEW_URL_KEY),
      getSetting(SMTP_HOST_KEY),
      getSetting(SMTP_PORT_KEY),
      getSetting(SMTP_USER_KEY),
      getSetting(SMTP_FROM_KEY),
      getSetting(SMTP_PASS_KEY),
      getSetting(GOOGLE_PLACE_ID_KEY),
      getSetting(GOOGLE_PLACES_API_KEY_KEY),
    ]);
    googleReviewUrl = g ?? "";
    smtp.host = host ?? "";
    smtp.port = port ?? "587";
    smtp.user = user ?? "";
    smtp.from = from ?? "";
    smtp.passSet = !!(pass && pass.length);
    places.placeId = placeId ?? "";
    places.apiKeySet = !!(apiKey && apiKey.length);
  } catch {
    /* leer lassen */
  }

  let baustellen: BaustelleDoc[] = [];
  try {
    baustellen = await listBaustellen();
  } catch {
    /* leer lassen */
  }

  // Agenten: Tagesbericht-Konfiguration + Workflow-Anzahl + KI-Status.
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
    /* Agenten-Panel wird ohne Werte nicht gerendert */
  }
  const kiConfigured = !!process.env.ANTHROPIC_API_KEY;

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Einstellungen</h1>
        <p className="mt-1 text-sm text-gray-600">Allgemeine Konfiguration des Dashboards.</p>
      </header>
      {dailyReport && (
        <AgentsPanel dailyReport={dailyReport} workflowCount={workflowCount} kiConfigured={kiConfigured} />
      )}
      <SettingsForm googleReviewUrl={googleReviewUrl} smtp={smtp} places={places} />
      <BaustellenAdmin items={baustellen} />
    </div>
  );
}
