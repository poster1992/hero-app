import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import {
  getHoursByProject,
  getCalculatedByProject,
  getProjects,
  getProjectPipeline,
  getWorkdays,
  getAbsences,
  getProjectPhotosUploadedOn,
  getDocumentsForDay,
  aggregateDayDocuments,
  type DailyPhoto,
  type DayDocumentVolume,
  type DayDocument,
} from "./hero-api";
import { getGlobalLogbookSystem } from "./logbook-core";
import { sendMailWithAttachments, type MailAttachment } from "./mailer";
import { listAdminUserIds, getUsersForNotification } from "./users";
import { listLohnEmployees } from "./lohn-employees";
import {
  getSetting,
  setSetting,
  DAILY_REPORT_ENABLED_KEY,
  DAILY_REPORT_HOUR_KEY,
  DAILY_REPORT_SEND_WHEN_EMPTY_KEY,
  DAILY_REPORT_RECIPIENTS_KEY,
  DAILY_REPORT_LAST_SENT_KEY,
  DAILY_REPORT_LAST_ATTEMPT_KEY,
  DAILY_REPORT_OVERRUN_THRESHOLD_KEY,
  DAILY_REPORT_CHECK_HOURS_KEY,
  DAILY_REPORT_CHECK_NOCALC_KEY,
  DAILY_REPORT_CHECK_LOGBOOK_KEY,
  DAILY_REPORT_CHECK_MISSING_KEY,
  DAILY_REPORT_LOGBOOK_KEYWORDS_KEY,
  DAILY_REPORT_INSTRUCTIONS_KEY,
} from "./settings";

// ---------------------------------------------------------------------------
// Zeit-/Datumshelfer (FLOORTEC sitzt in Luxemburg; Server/Container laufen UTC).
// ---------------------------------------------------------------------------

const TZ = "Europe/Luxembourg";

/** Aktuelles lokales Datum (YYYY-MM-DD) in der Betriebs-Zeitzone. */
export function localDateIso(d: Date = new Date()): string {
  // en-CA formatiert als YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Aktuelle lokale Stunde (0–23) in der Betriebs-Zeitzone. */
export function localHour(d: Date = new Date()): number {
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(d);
  const n = Number(h);
  return Number.isFinite(n) ? n % 24 : 0;
}

/** Vortag (YYYY-MM-DD) zu einem gegebenen ISO-Datum. */
export function previousDayIso(dayIso: string): string {
  const [y, m, d] = dayIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export type Severity = "hoch" | "mittel" | "niedrig";

export interface Anomaly {
  kind: "projekt" | "logbuch" | "ueberstunden" | "nicht_erfasst";
  severity: Severity;
  title: string;
  detail: string;
  ref?: string;
}

export interface ActivityProject {
  id: number;
  relativeId: number | null;
  name: string;
  entries: { author: string | null; text: string }[];
  photos: DailyPhoto[];
}

export interface DailyActivity {
  dayIso: string;
  projects: ActivityProject[];
  /** Foto-Anzahl, die wegen des Limits nicht mehr eingebettet wurde. */
  photosOmitted: number;
}

export interface AnomalyReport {
  /** Betrachteter Tag für tagesscharfe Auffälligkeiten (Vortag). */
  dayIso: string;
  generatedAtIso: string;
  sections: {
    projekt: Anomaly[];
    logbuch: Anomaly[];
    ueberstunden: Anomaly[];
    nichtErfasst: Anomaly[];
  };
  activity: DailyActivity;
  /** Angebote / Aufträge / Rechnungen des heutigen Tages (Anzahl + Netto). */
  documents: DayDocumentVolume;
  /** Einzelne Dokumente des heutigen Tages (für die Liste). */
  documentList: DayDocument[];
  /** Arbeitszeiten aller Mitarbeiter am Vortag (rot: nichts eingereicht). */
  workHours: EmployeeDay[];
  sourceErrors: string[];
  totalCount: number;
  /** Freitext-Zusatzanweisung an die KI (aus der Konfiguration). */
  kiInstructions: string;
}

/** Arbeitszeit eines Mitarbeiters an einem Tag (für die Roster-Liste im Bericht). */
export interface EmployeeDay {
  partnerId: number;
  name: string;
  workedHours: number;
  targetHours: number;
  /** Hat Arbeitszeit eingereicht (workedHours > 0). */
  submitted: boolean;
  /** Am Tag abwesend (Urlaub/krank/…) – dann kein Rot. */
  absent: boolean;
  absenceType: string | null;
}

const EMPTY_DOCS: DayDocumentVolume = {
  offers: { count: 0, net: 0 },
  confirmations: { count: 0, net: 0 },
  invoices: { count: 0, net: 0 },
};

const ABSENCE_LABEL: Record<string, string> = {
  vacation: "Urlaub",
  sick: "krank",
  parental_leave: "Elternzeit",
};

// Stichwörter, die einen Logbuch-Eintrag als "Problem" markieren.
const PROBLEM_RE =
  /problem|mangel|beschädig|beschaedig|reklamation|verzögerung|verzoeger|verspätung|verspaetung|fehlt|fehler|defekt|schaden|stopp|stillstand|beschwerde|nacharbeit|nicht möglich|nicht moeglich|streit|eskal/i;

// Systemeinträge (Titel) – analog SYSTEM_TITLE_RE, hier nur zum Ausschluss.
const SYSTEM_TITLE_RE =
  /hochgeladen|eingetragen|zugewiesen|erstellt|geändert|geaendert|^status:|eingegangen|gelöscht|geloescht|verschoben|storniert|abgeschlossen/i;

const MAX_PHOTOS = 30;

// ---------------------------------------------------------------------------
// Sammler
// ---------------------------------------------------------------------------

/** (c) Projekte mit Ist-Stunden über den Soll-Stunden (nur aktive Projekte). */
function collectProjectHourOverruns(
  activeIds: Set<number>,
  ist: Map<number, number>,
  soll: Map<number, { hours: number }>,
  names: Map<number, { name: string; relativeId: number | null }>,
  thresholdPct: number
): Anomaly[] {
  const out: Anomaly[] = [];
  const factor = thresholdPct / 100;
  for (const pid of activeIds) {
    const sollH = soll.get(pid)?.hours ?? 0;
    const istH = ist.get(pid) ?? 0;
    if (sollH <= 0 || istH <= sollH * factor) continue;
    const ratio = istH / sollH;
    const p = names.get(pid);
    const label = p ? `${p.relativeId ? `#${p.relativeId} ` : ""}${p.name}` : `Projekt ${pid}`;
    out.push({
      kind: "ueberstunden",
      severity: ratio >= 1.3 ? "hoch" : ratio >= 1.1 ? "mittel" : "niedrig",
      title: `${label}: Ist über Soll (${Math.round(ratio * 100)} %)`,
      detail: `Erfasste Stunden ${istH.toFixed(1)} h liegen über den kalkulierten ${sollH.toFixed(1)} h (${(istH - sollH).toFixed(1)} h mehr).`,
      ref: `p${pid}`,
    });
  }
  return out.sort((a, b) => sevRank(b.severity) - sevRank(a.severity));
}

/** (a) Aktive Projekte in Umsetzung mit erfassten Stunden, aber ohne Soll-Kalkulation. */
function collectProjectAnomalies(
  activeIds: Set<number>,
  ist: Map<number, number>,
  soll: Map<number, { hours: number }>,
  names: Map<number, { name: string; relativeId: number | null }>
): Anomaly[] {
  const out: Anomaly[] = [];
  for (const pid of activeIds) {
    const istH = ist.get(pid) ?? 0;
    const sollH = soll.get(pid)?.hours ?? 0;
    // Stunden gebucht, aber keine Kalkulation hinterlegt → nicht kontrollierbar.
    if (istH > 0 && sollH <= 0) {
      const p = names.get(pid);
      const label = p ? `${p.relativeId ? `#${p.relativeId} ` : ""}${p.name}` : `Projekt ${pid}`;
      out.push({
        kind: "projekt",
        severity: istH >= 20 ? "mittel" : "niedrig",
        title: `${label}: Stunden ohne Kalkulation`,
        detail: `${istH.toFixed(1)} h erfasst, aber keine Soll-Kalkulation hinterlegt – Ist/Soll nicht kontrollierbar.`,
        ref: `p${pid}`,
      });
    }
  }
  return out.sort((a, b) => sevRank(b.severity) - sevRank(a.severity));
}

/** (b) Logbuch-Einträge des Tages, die auf ein Problem hindeuten. */
async function collectLogbookProblems(dayIso: string, keywords: string[]): Promise<Anomaly[]> {
  const log = await getGlobalLogbookSystem(300);
  // Eigene Stichwortliste (aus der Konfiguration) hat Vorrang; sonst Standard.
  const re =
    keywords.length > 0
      ? new RegExp(keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i")
      : PROBLEM_RE;
  const out: Anomaly[] = [];
  for (const e of log) {
    if (!e.date || e.date.slice(0, 10) !== dayIso) continue;
    if (SYSTEM_TITLE_RE.test(e.title)) continue; // automatische Ereignisse ignorieren
    const hay = `${e.title} ${e.text}`;
    if (!re.test(hay)) continue;
    const proj = e.projectName
      ? `${e.projectRelativeId ? `#${e.projectRelativeId} ` : ""}${e.projectName}`
      : "ohne Projekt";
    const snippet = e.text.length > 180 ? e.text.slice(0, 177) + "…" : e.text;
    out.push({
      kind: "logbuch",
      severity: "mittel",
      title: `Logbuch-Hinweis: ${proj}`,
      detail: `${e.author ? e.author + ": " : ""}${snippet}`,
      ref: `log${e.id}`,
    });
  }
  return out;
}

/** (d) Mitarbeiter, die sich am Tag nicht erfasst haben (ohne Urlauber/Kranke). */
async function collectMissingTimeEntries(dayIso: string): Promise<Anomaly[]> {
  const [workdays, absences] = await Promise.all([
    getWorkdays(dayIso, dayIso),
    getAbsences(dayIso, dayIso),
  ]);
  const absentIds = new Set(absences.map((a) => a.partnerId));
  const out: Anomaly[] = [];
  for (const w of workdays) {
    if (w.targetHours > 0 && w.workedHours === 0 && !absentIds.has(w.partnerId)) {
      out.push({
        kind: "nicht_erfasst",
        severity: "mittel",
        title: `Keine Zeiterfassung: ${w.partnerName}`,
        detail: `Sollarbeitszeit ${w.targetHours.toFixed(1)} h, aber 0 h erfasst und keine Abwesenheit hinterlegt.`,
        ref: `ma${w.partnerId}`,
      });
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, "de"));
}

const normName = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Alle aktiven Mitarbeiter mit ihren Arbeitszeiten am Tag. Roster kommt aus der
 * Lohn-Mitarbeiterliste (nicht aus HERO – dort gibt es für Nicht-Stempler keinen
 * Datensatz), verknüpft per Name mit den HERO-Zeiten/Abwesenheiten. Rot = nichts
 * eingereicht und nicht abwesend.
 */
async function collectWorkHours(dayIso: string): Promise<EmployeeDay[]> {
  const [employees, workdays, absences] = await Promise.all([
    listLohnEmployees(false), // nur aktive
    getWorkdays(dayIso, dayIso),
    getAbsences(dayIso, dayIso),
  ]);
  const wdByName = new Map<string, (typeof workdays)[number]>();
  for (const w of workdays) if (!wdByName.has(normName(w.partnerName))) wdByName.set(normName(w.partnerName), w);
  const absByName = new Map<string, string>();
  for (const a of absences) if (!absByName.has(normName(a.partnerName))) absByName.set(normName(a.partnerName), a.type);

  const list: EmployeeDay[] = [];
  const seen = new Set<string>();
  const add = (name: string, wd: (typeof workdays)[number] | undefined, partnerId: number) => {
    const key = normName(name);
    if (seen.has(key)) return;
    seen.add(key);
    const absType = absByName.get(key) ?? null;
    list.push({
      partnerId,
      name,
      workedHours: wd?.workedHours ?? 0,
      targetHours: wd?.targetHours ?? 0,
      submitted: (wd?.workedHours ?? 0) > 0,
      absent: absType != null,
      absenceType: absType,
    });
  };

  // 1) Alle aktiven Lohn-Mitarbeiter (das vollständige Roster).
  for (const emp of employees) {
    const wd = wdByName.get(normName(emp.name));
    add(emp.name, wd, wd?.partnerId ?? emp.id);
  }
  // 2) HERO-Stempler, die (noch) nicht in der Lohn-Liste stehen, ergänzen.
  for (const w of workdays) add(w.partnerName, w, w.partnerId);

  // Fehlende Erfassung (rot) zuerst, dann alphabetisch.
  list.sort((a, b) => {
    const aRed = !a.submitted && !a.absent;
    const bRed = !b.submitted && !b.absent;
    if (aRed !== bRed) return aRed ? -1 : 1;
    return a.name.localeCompare(b.name, "de");
  });
  return list;
}

function sevRank(s: Severity): number {
  return s === "hoch" ? 3 : s === "mittel" ? 2 : 1;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** Sammelt alle Auffälligkeiten (tagesscharfe für den Vortag) fehlertolerant. */
export async function collectAnomalies(): Promise<AnomalyReport> {
  const cfg = await getDailyReportConfig();
  const today = localDateIso();
  const dayIso = previousDayIso(today);
  const sourceErrors: string[] = [];

  const sections: AnomalyReport["sections"] = {
    projekt: [],
    logbuch: [],
    ueberstunden: [],
    nichtErfasst: [],
  };

  // Basisdaten für die Projekt-Regeln einmal laden.
  const activeIds = new Set<number>();
  const ist = new Map<number, number>();
  const soll = new Map<number, { hours: number }>();
  const names = new Map<number, { name: string; relativeId: number | null }>();

  const base = await Promise.allSettled([
    getProjectPipeline(),
    getHoursByProject(),
    getCalculatedByProject(),
    getProjects(),
  ]);
  if (base[0].status === "fulfilled") {
    for (const st of base[0].value.stages) {
      if (st.phaseCode === 1111) for (const p of st.projects) activeIds.add(p.id);
    }
  } else sourceErrors.push("Projekt-Pipeline");
  if (base[1].status === "fulfilled") for (const [k, v] of base[1].value) ist.set(k, v);
  else sourceErrors.push("Ist-Stunden");
  if (base[2].status === "fulfilled") for (const [k, v] of base[2].value) soll.set(k, { hours: v.hours });
  else sourceErrors.push("Soll-Kalkulation");
  if (base[3].status === "fulfilled")
    for (const p of base[3].value) names.set(p.id, { name: p.name, relativeId: p.relativeId });
  else sourceErrors.push("Projektliste");

  // Regeln, die nur die Basisdaten brauchen (synchron), plus die zwei async-Sammler.
  // Jede Prüfung nur, wenn in der Konfiguration aktiviert.
  if (activeIds.size > 0) {
    if (cfg.checks.hours)
      sections.ueberstunden = collectProjectHourOverruns(activeIds, ist, soll, names, cfg.overrunThreshold);
    if (cfg.checks.nocalc) sections.projekt = collectProjectAnomalies(activeIds, ist, soll, names);
  }

  const [logRes, missRes] = await Promise.allSettled([
    cfg.checks.logbook ? collectLogbookProblems(dayIso, cfg.logbookKeywords) : Promise.resolve([]),
    cfg.checks.missing ? collectMissingTimeEntries(dayIso) : Promise.resolve([]),
  ]);
  if (logRes.status === "fulfilled") sections.logbuch = logRes.value;
  else sourceErrors.push("Logbuch");
  if (missRes.status === "fulfilled") sections.nichtErfasst = missRes.value;
  else sourceErrors.push("Zeiterfassung");

  const activity = await collectDailyActivity(today).catch((): DailyActivity => {
    sourceErrors.push("Tages-Aktivität");
    return { dayIso: today, projects: [], photosOmitted: 0 };
  });

  const documentList = await getDocumentsForDay(today).catch((): DayDocument[] => {
    sourceErrors.push("Angebote/Aufträge/Rechnungen");
    return [];
  });
  const documents = documentList.length > 0 ? aggregateDayDocuments(documentList) : EMPTY_DOCS;

  const workHours = await collectWorkHours(dayIso).catch((): EmployeeDay[] => {
    sourceErrors.push("Arbeitszeiten-Liste");
    return [];
  });

  const totalCount =
    sections.projekt.length +
    sections.logbuch.length +
    sections.ueberstunden.length +
    sections.nichtErfasst.length;

  return {
    dayIso,
    generatedAtIso: new Date().toISOString(),
    sections,
    activity,
    documents,
    documentList,
    workHours,
    sourceErrors,
    totalCount,
    kiInstructions: cfg.instructions,
  };
}

/**
 * Tages-Aktivitätsliste (bewusst HEUTE): Projekte mit Logbuch-Eintrag heute + die
 * heute hochgeladenen Fotos dieser Projekte (Thumbnails, für die Mail-Einbettung).
 */
export async function collectDailyActivity(todayIso: string): Promise<DailyActivity> {
  const log = await getGlobalLogbookSystem(300);

  // Nach Projekt gruppieren (nur echte Notizen von heute, mit Projektbezug).
  const byProject = new Map<number, ActivityProject>();
  for (const e of log) {
    if (!e.date || e.date.slice(0, 10) !== todayIso) continue;
    if (SYSTEM_TITLE_RE.test(e.title)) continue;
    if (e.projectId == null) continue;
    const existing =
      byProject.get(e.projectId) ??
      ({
        id: e.projectId,
        relativeId: e.projectRelativeId,
        name: e.projectName ?? `Projekt ${e.projectId}`,
        entries: [],
        photos: [],
      } as ActivityProject);
    existing.entries.push({ author: e.author, text: e.text });
    byProject.set(e.projectId, existing);
  }

  const projects = [...byProject.values()];

  // Fotos je Projekt laden (heute hochgeladen), mit Gesamt-Limit.
  let budget = MAX_PHOTOS;
  let omitted = 0;
  for (const p of projects) {
    if (budget <= 0) break;
    try {
      const photos = await getProjectPhotosUploadedOn(p.id, todayIso);
      if (photos.length > budget) {
        omitted += photos.length - budget;
        p.photos = photos.slice(0, budget);
        budget = 0;
      } else {
        p.photos = photos;
        budget -= photos.length;
      }
    } catch {
      // Fotos sind optional – Projekt bleibt in der Liste, nur ohne Bilder.
    }
  }

  return { dayIso: todayIso, projects, photosOmitted: omitted };
}

// ---------------------------------------------------------------------------
// KI-Zusammenfassung der Auffälligkeiten (nur die Auffälligkeiten, nicht die Aktivität)
// ---------------------------------------------------------------------------

const MODELS = ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-8"];

function isTransient(e: unknown): boolean {
  return (
    e instanceof Anthropic.APIError &&
    (e.status === 529 || e.status === 429 || (e.status ?? 0) >= 500)
  );
}

const dayFmt = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return dayFmt.format(new Date(Date.UTC(y, m - 1, d)));
}

/** Nur erlaubte einfache Tags durchlassen (der Text geht in eine E-Mail). */
function sanitizeFragment(html: string): string {
  return html
    .replace(/```html?/gi, "")
    .replace(/```/g, "")
    .replace(/<(?!\/?(h2|h3|p|ul|ol|li|strong|em|br)\b)[^>]*>/gi, "")
    .trim();
}

/**
 * Lässt Claude aus den geprüften Auffälligkeiten einen priorisierten, lesbaren
 * HTML-Text formulieren. Fällt auf renderPlainReportHtml zurück, wenn kein API-Key
 * vorhanden ist oder alle Modelle überlastet sind. Zahlen bleiben exakt (aus den Regeln).
 */
export async function generateReportText(report: AnomalyReport): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) return renderPlainReportHtml(report);

  const payload = {
    tag: report.dayIso,
    auffaelligkeiten: report.sections,
    hinweisFehlendeQuellen: report.sourceErrors,
  };
  const system =
    "Du bist der Betriebsanalyst von FLOORTEC (Bodenleger-/Handwerksbetrieb). " +
    "Du erhältst eine JSON-Liste bereits geprüfter, EXAKTER Auffälligkeiten eines Tages. " +
    "Formuliere daraus einen knappen, gut lesbaren, nach Dringlichkeit priorisierten Tagesbericht auf Deutsch für die Geschäftsleitung. " +
    "Regeln: Ändere KEINE Zahlen, erfinde nichts, füge keine Auffälligkeiten hinzu, die nicht in den Daten stehen. " +
    "Gruppiere sinnvoll (Projekte/Stunden, Zeiterfassung, Logbuch), hoch zuerst. " +
    "Gib NUR ein HTML-Fragment aus (erlaubt: h2, h3, p, ul, li, strong, em) — kein Markdown, kein ```-Codeblock, kein <html>/<head>, keine style-Attribute. " +
    "Wenn keine Auffälligkeiten vorliegen, schreibe einen kurzen Entwarnungssatz." +
    (report.kiInstructions
      ? `\n\nZusätzliche Anweisungen der Geschäftsleitung (beachten, aber niemals Zahlen erfinden): ${report.kiInstructions}`
      : "");
  const user =
    `Betrachteter Tag: ${report.dayIso}. Erzeuge den Tagesbericht aus diesen geprüften Daten:\n\n` +
    JSON.stringify(payload, null, 2);

  const client = new Anthropic({ maxRetries: 2, timeout: 60_000 });
  let lastErr: unknown;
  for (const model of MODELS) {
    try {
      const res = await client.messages.create({
        model,
        max_tokens: 2000,
        system,
        messages: [{ role: "user", content: user }],
      });
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (text) return sanitizeFragment(text);
    } catch (e) {
      if (isTransient(e)) {
        lastErr = e;
        continue;
      }
      // Nicht-transienter Fehler → Fallback statt Absturz.
      return renderPlainReportHtml(report);
    }
  }
  void lastErr;
  return renderPlainReportHtml(report);
}

const SECTION_LABELS: Record<keyof AnomalyReport["sections"], string> = {
  ueberstunden: "Projekte: Stunden über Kalkulation",
  projekt: "Projekte: weitere Auffälligkeiten",
  nichtErfasst: "Zeiterfassung fehlt",
  logbuch: "Hinweise aus dem Logbuch",
};

/** Deterministischer HTML-Bericht ohne KI (Fallback). */
export function renderPlainReportHtml(report: AnomalyReport): string {
  if (report.totalCount === 0) {
    return `<p>Keine Auffälligkeiten für ${esc(fmtDay(report.dayIso))}.</p>`;
  }
  const order: (keyof AnomalyReport["sections"])[] = ["ueberstunden", "projekt", "nichtErfasst", "logbuch"];
  const parts: string[] = [];
  for (const key of order) {
    const items = report.sections[key];
    if (items.length === 0) continue;
    parts.push(`<h3>${SECTION_LABELS[key]} (${items.length})</h3><ul>`);
    for (const a of items) {
      parts.push(`<li><strong>${esc(a.title)}</strong><br>${esc(a.detail)}</li>`);
    }
    parts.push("</ul>");
  }
  return parts.join("\n");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------------------

export interface DailyReportConfig {
  enabled: boolean;
  hour: number;
  sendWhenEmpty: boolean;
  extraRecipients: string[];
  /** Prozentschwelle für Ist>Soll (100 = auffällig sobald Ist über Soll). */
  overrunThreshold: number;
  checks: { hours: boolean; nocalc: boolean; logbook: boolean; missing: boolean };
  /** Stichwörter für die Logbuch-Problemerkennung (leer = Standardliste). */
  logbookKeywords: string[];
  /** Freitext-Zusatzanweisung an die KI (leer = keine). */
  instructions: string;
}

export async function getDailyReportConfig(): Promise<DailyReportConfig> {
  const [enabled, hour, empty, recips, thr, cH, cN, cL, cM, kw, instr] = await Promise.all([
    getSetting(DAILY_REPORT_ENABLED_KEY),
    getSetting(DAILY_REPORT_HOUR_KEY),
    getSetting(DAILY_REPORT_SEND_WHEN_EMPTY_KEY),
    getSetting(DAILY_REPORT_RECIPIENTS_KEY),
    getSetting(DAILY_REPORT_OVERRUN_THRESHOLD_KEY),
    getSetting(DAILY_REPORT_CHECK_HOURS_KEY),
    getSetting(DAILY_REPORT_CHECK_NOCALC_KEY),
    getSetting(DAILY_REPORT_CHECK_LOGBOOK_KEY),
    getSetting(DAILY_REPORT_CHECK_MISSING_KEY),
    getSetting(DAILY_REPORT_LOGBOOK_KEYWORDS_KEY),
    getSetting(DAILY_REPORT_INSTRUCTIONS_KEY),
  ]);
  // Achtung: Number(null) === 0 – daher leere Werte explizit als "nicht gesetzt" behandeln,
  // sonst liefe der Bericht ohne gespeicherte Stunde um Mitternacht statt um 18 Uhr.
  const h = hour ? Number(hour) : NaN;
  const t = thr ? Number(thr) : NaN;
  return {
    enabled: enabled !== "0",
    hour: Number.isFinite(h) && h >= 0 && h <= 23 ? h : 18,
    sendWhenEmpty: empty !== "0",
    extraRecipients: (recips ?? "")
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)),
    overrunThreshold: Number.isFinite(t) && t >= 100 && t <= 500 ? t : 100,
    checks: {
      hours: cH !== "0",
      nocalc: cN !== "0",
      logbook: cL !== "0",
      missing: cM !== "0",
    },
    logbookKeywords: (kw ?? "")
      .split(/[,\n;]+/)
      .map((s) => s.trim())
      .filter(Boolean),
    instructions: (instr ?? "").trim(),
  };
}

// ---------------------------------------------------------------------------
// HTML-Mail
// ---------------------------------------------------------------------------

const RED = "#e8392a";

function appBase(): string {
  return process.env.APP_URL?.replace(/\/$/, "") || "https://floortec.pascaloster.de";
}

/** Lädt die Thumbnails der Aktivitäts-Fotos und liefert cid-Anhänge + id→cid-Map. */
async function loadPhotoThumbnails(
  activity: DailyActivity
): Promise<{ attachments: MailAttachment[]; cidById: Map<number, string> }> {
  const attachments: MailAttachment[] = [];
  const cidById = new Map<number, string>();
  const all: DailyPhoto[] = activity.projects.flatMap((p) => p.photos);
  await Promise.all(
    all.map(async (photo) => {
      try {
        const res = await fetch(photo.thumbUrl, { cache: "no-store" });
        if (!res.ok) return;
        const buf = Buffer.from(await res.arrayBuffer());
        const cid = `foto-${photo.id}@floortec`;
        attachments.push({
          filename: `foto-${photo.id}.png`,
          content: buf,
          cid,
          contentType: res.headers.get("content-type") || "image/png",
        });
        cidById.set(photo.id, cid);
      } catch {
        // Ein nicht ladbares Thumbnail wird einfach weggelassen.
      }
    })
  );
  return { attachments, cidById };
}

/** Baut die vollständige HTML-Mail (Auffälligkeiten-Text + Tages-Aktivitätsliste). */
function buildDailyReportHtml(
  bodyHtml: string,
  report: AnomalyReport,
  cidById: Map<number, string>,
  logoUrl: string
): string {
  const projectsUrl = `${appBase()}/dashboard/projekte`;
  const severe = [...report.sections.ueberstunden, ...report.sections.projekt, ...report.sections.logbuch, ...report.sections.nichtErfasst].filter(
    (a) => a.severity === "hoch"
  ).length;
  const kennzahl = `${report.totalCount} ${report.totalCount === 1 ? "Auffälligkeit" : "Auffälligkeiten"}${severe ? ` · ${severe} hoch` : ""}`;

  // Tages-Aktivitätsliste (statisch, nicht von der KI).
  let activityHtml: string;
  if (report.activity.projects.length === 0) {
    activityHtml = `<p style="margin:0;color:#8a929c;">Heute keine Logbuch-Aktivität.</p>`;
  } else {
    const blocks = report.activity.projects.map((p) => {
      const label = `${p.relativeId ? `#${p.relativeId} ` : ""}${esc(p.name)}`;
      const entries = p.entries
        .map(
          (e) =>
            `<li style="margin:0 0 4px;">${e.author ? `<strong>${esc(e.author)}:</strong> ` : ""}${esc(e.text).replace(/\n/g, "<br>")}</li>`
        )
        .join("");
      const photos = p.photos
        .map((ph) => {
          const cid = cidById.get(ph.id);
          if (!cid) return "";
          return `<a href="${projectsUrl}" target="_blank" style="text-decoration:none;"><img src="cid:${cid}" alt="${esc(ph.filename)}" width="110" height="110" style="width:110px;height:110px;object-fit:cover;border-radius:6px;border:1px solid #eceef1;margin:0 6px 6px 0;" /></a>`;
        })
        .join("");
      return `
        <div style="margin:0 0 18px;">
          <p style="margin:0 0 6px;font-size:15px;font-weight:700;color:#111417;">
            <a href="${projectsUrl}" target="_blank" style="color:${RED};text-decoration:none;">${label}</a>
          </p>
          <ul style="margin:0 0 8px;padding-left:18px;font-size:14px;line-height:1.5;color:#3f4650;">${entries}</ul>
          ${photos ? `<div>${photos}</div>` : ""}
        </div>`;
    });
    activityHtml = blocks.join("");
    if (report.activity.photosOmitted > 0) {
      activityHtml += `<p style="margin:0;font-size:12px;color:#8a929c;">+${report.activity.photosOmitted} weitere Fotos (in der App).</p>`;
    }
  }

  const errorBox =
    report.sourceErrors.length > 0
      ? `<div style="margin:0 0 18px;padding:10px 14px;background:#fff5f4;border:1px solid ${RED}33;border-radius:8px;font-size:13px;color:#8a4b46;">
           Hinweis: ${esc(report.sourceErrors.join(", "))} war nicht abrufbar – der Bericht enthält Teildaten.
         </div>`
      : "";

  // Angebote / Aufträge / Rechnungen des Tages (Anzahl + Netto).
  const eur = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const docCell = (label: string, v: { count: number; net: number }) =>
    `<td width="33%" style="padding:14px 10px;text-align:center;vertical-align:top;">
       <div style="font-size:12px;color:#8a929c;text-transform:uppercase;letter-spacing:.4px;">${label}</div>
       <div style="font-size:22px;font-weight:700;color:#111417;margin:4px 0 2px;">${v.count}</div>
       <div style="font-size:13px;color:#3f4650;">${eur(v.net)}</div>
     </td>`;
  const d = report.documents;
  const docsHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eceef1;border-radius:8px;background:#fafbfc;">
      <tr>
        ${docCell("Angebote", d.offers)}
        <td width="1" style="background:#eceef1;"></td>
        ${docCell("Aufträge", d.confirmations)}
        <td width="1" style="background:#eceef1;"></td>
        ${docCell("Rechnungen", d.invoices)}
      </tr>
    </table>
    <p style="margin:8px 0 0;font-size:12px;color:#8a929c;">Netto, Belegdatum heute (ohne gelöschte; Gutschriften/Stornos abgezogen).</p>`;

  // Dokumentliste (Datum, Typ, Kunde, Projekt, Netto).
  const DOC_LABEL: Record<DayDocument["kind"], string> = {
    offer: "Angebot",
    confirmation: "Auftrag",
    invoice: "Rechnung",
    gutschrift: "Gutschrift",
    storno: "Storno",
  };
  const shortDate = (iso: string) => {
    const [, m, dd] = iso.split("-");
    return `${dd}.${m}.`;
  };
  const th = `padding:0 8px 6px;font-size:11px;color:#8a929c;text-transform:uppercase;letter-spacing:.4px;`;
  const td = `padding:6px 8px;border-top:1px solid #eceef1;font-size:13px;`;
  let docListHtml: string;
  if (report.documentList.length === 0) {
    docListHtml = `<p style="margin:14px 0 0;font-size:13px;color:#8a929c;">Heute keine Angebote, Aufträge oder Rechnungen.</p>`;
  } else {
    const rows = report.documentList
      .map((doc) => {
        const dispNet = doc.kind === "gutschrift" || doc.kind === "storno" ? -Math.abs(doc.net) : doc.net;
        const proj = doc.projectName
          ? `${doc.projectRelativeId ? `#${doc.projectRelativeId} ` : ""}${esc(doc.projectName)}`
          : "–";
        return `<tr>
          <td style="${td}color:#8a929c;white-space:nowrap;">${shortDate(doc.date)}</td>
          <td style="${td}color:#3f4650;white-space:nowrap;">${DOC_LABEL[doc.kind]}</td>
          <td style="${td}color:#111417;">${esc(doc.customerName ?? "–")}</td>
          <td style="${td}color:#3f4650;">${proj}</td>
          <td style="${td}color:#111417;text-align:right;white-space:nowrap;">${eur(dispNet)}</td>
        </tr>`;
      })
      .join("");
    docListHtml = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 0;border-collapse:collapse;">
        <tr>
          <td style="${th}">Datum</td><td style="${th}">Typ</td><td style="${th}">Kunde</td><td style="${th}">Projekt</td><td style="${th}text-align:right;">Netto</td>
        </tr>
        ${rows}
      </table>`;
  }

  // Arbeitszeiten aller Mitarbeiter am Vortag (rot: nichts eingereicht, nicht abwesend).
  let workHoursHtml: string;
  if (report.workHours.length === 0) {
    workHoursHtml = `<p style="margin:0;color:#8a929c;">Keine Arbeitszeitdaten.</p>`;
  } else {
    const rows = report.workHours
      .map((e) => {
        const red = !e.submitted && !e.absent;
        const nameColor = red ? "#b91c1c" : "#111417";
        const hint = e.absent
          ? ABSENCE_LABEL[e.absenceType ?? ""] ?? e.absenceType ?? "abwesend"
          : e.submitted
            ? ""
            : "keine Zeit eingereicht";
        const hintColor = red ? "#b91c1c" : "#8a929c";
        return `<tr style="${red ? "background:#fff5f4;" : ""}">
          <td style="${td}font-weight:${red ? "700" : "400"};color:${nameColor};">${esc(e.name)}</td>
          <td style="${td}color:${nameColor};text-align:right;white-space:nowrap;">${e.workedHours.toFixed(1)} h</td>
          <td style="${td}color:#8a929c;text-align:right;white-space:nowrap;">${e.targetHours.toFixed(1)} h</td>
          <td style="${td}color:${hintColor};font-size:12px;">${esc(hint)}</td>
        </tr>`;
      })
      .join("");
    workHoursHtml = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <td style="${th}">Mitarbeiter</td><td style="${th}text-align:right;">Ist</td><td style="${th}text-align:right;">Soll</td><td style="${th}">Hinweis</td>
        </tr>
        ${rows}
      </table>`;
  }

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light only"/><title>FLOORTEC Tagesbericht</title></head>
<body style="margin:0;padding:0;background:#f2f3f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f3f5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,0.08);font-family:Arial,Helvetica,sans-serif;">
        <tr><td align="center" style="background:#ffffff;padding:24px 32px 14px;">
          <img src="${logoUrl}" alt="FLOORTEC" width="190" style="display:block;border:0;height:auto;width:190px;max-width:60%;" />
        </td></tr>
        <tr><td style="height:4px;background:${RED};line-height:4px;font-size:0;">&nbsp;</td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <h1 style="margin:0 0 4px;font-size:21px;color:#111417;">Tagesbericht – ${esc(fmtDay(report.dayIso))}</h1>
          <p style="margin:0 0 18px;font-size:13px;color:#8a929c;">${kennzahl}</p>
          ${errorBox}
          <div style="font-size:15px;line-height:1.6;color:#3f4650;">${bodyHtml}</div>
        </td></tr>
        <tr><td style="padding:6px 32px 8px;">
          <div style="height:1px;background:#eceef1;margin:0 0 18px;"></div>
          <h2 style="margin:0 0 14px;font-size:18px;color:#111417;">Angebote, Aufträge &amp; Rechnungen (heute)</h2>
          ${docsHtml}
          ${docListHtml}
        </td></tr>
        <tr><td style="padding:18px 32px 8px;">
          <div style="height:1px;background:#eceef1;margin:0 0 18px;"></div>
          <h2 style="margin:0 0 14px;font-size:18px;color:#111417;">Arbeitszeiten – ${esc(fmtDay(report.dayIso))}</h2>
          ${workHoursHtml}
        </td></tr>
        <tr><td style="padding:18px 32px 28px;">
          <div style="height:1px;background:#eceef1;margin:0 0 18px;"></div>
          <h2 style="margin:0 0 14px;font-size:18px;color:#111417;">Heutige Aktivität</h2>
          ${activityHtml}
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #eceef1;background:#fafbfc;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#8a929c;">
            Automatischer Tagesbericht · FLOORTEC Dashboard<br/>
            <a href="${appBase()}/dashboard" target="_blank" style="color:${RED};">Zum Dashboard</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** Plaintext-Variante für Clients ohne HTML. */
function buildDailyReportText(report: AnomalyReport): string {
  const lines: string[] = [`FLOORTEC Tagesbericht – ${fmtDay(report.dayIso)}`, ""];
  const order: (keyof AnomalyReport["sections"])[] = ["ueberstunden", "projekt", "nichtErfasst", "logbuch"];
  if (report.totalCount === 0) lines.push("Keine Auffälligkeiten.");
  for (const key of order) {
    const items = report.sections[key];
    if (!items.length) continue;
    lines.push(`## ${SECTION_LABELS[key]} (${items.length})`);
    for (const a of items) lines.push(`- ${a.title}: ${a.detail}`);
    lines.push("");
  }
  const eur = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const d = report.documents;
  lines.push("Angebote, Aufträge & Rechnungen (heute, netto):");
  lines.push(`  Angebote:   ${d.offers.count} · ${eur(d.offers.net)}`);
  lines.push(`  Aufträge:   ${d.confirmations.count} · ${eur(d.confirmations.net)}`);
  lines.push(`  Rechnungen: ${d.invoices.count} · ${eur(d.invoices.net)}`);
  const DOC_LABEL: Record<string, string> = { offer: "Angebot", confirmation: "Auftrag", invoice: "Rechnung", gutschrift: "Gutschrift", storno: "Storno" };
  for (const doc of report.documentList) {
    const proj = doc.projectName ? `${doc.projectRelativeId ? `#${doc.projectRelativeId} ` : ""}${doc.projectName}` : "–";
    const net = doc.kind === "gutschrift" || doc.kind === "storno" ? -Math.abs(doc.net) : doc.net;
    lines.push(`  - ${DOC_LABEL[doc.kind]} · ${doc.customerName ?? "–"} · ${proj} · ${eur(net)}`);
  }
  lines.push("");
  lines.push(`Arbeitszeiten – ${fmtDay(report.dayIso)}:`);
  if (report.workHours.length === 0) lines.push("  keine Daten");
  for (const e of report.workHours) {
    const red = !e.submitted && !e.absent;
    const hint = e.absent ? ` (${e.absenceType ?? "abwesend"})` : red ? "  <-- KEINE ZEIT EINGEREICHT" : "";
    lines.push(`  ${red ? "! " : "  "}${e.name}: ${e.workedHours.toFixed(1)} h / Soll ${e.targetHours.toFixed(1)} h${hint}`);
  }
  lines.push("");
  lines.push("Heutige Aktivität:");
  if (report.activity.projects.length === 0) lines.push("  keine Logbuch-Aktivität");
  for (const p of report.activity.projects) {
    lines.push(`  - ${p.relativeId ? `#${p.relativeId} ` : ""}${p.name} (${p.entries.length} Einträge, ${p.photos.length} Fotos)`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Versand + Zeitsteuerung
// ---------------------------------------------------------------------------

/**
 * Erstellt den Bericht und versendet ihn. Wirft nie.
 * - `recipients` überschreibt die Empfänger (z.B. für einen Testversand an eine Adresse).
 * - `force` umgeht den An/Aus-Schalter und den „nichts zu berichten"-Skip.
 */
export async function sendDailyReport(
  opts: { force?: boolean; recipients?: string[] } = {}
): Promise<{ sent: boolean; reason?: string }> {
  try {
    const cfg = await getDailyReportConfig();
    if (!cfg.enabled && !opts.force) return { sent: false, reason: "deaktiviert" };

    // Empfänger: explizite Vorgabe (Test) oder aktive Admins + Zusatzadressen.
    const emails = new Set<string>();
    if (opts.recipients && opts.recipients.length > 0) {
      for (const e of opts.recipients) if (e) emails.add(e);
    } else {
      const admins = await getUsersForNotification(await listAdminUserIds());
      for (const a of admins) if (a.email) emails.add(a.email);
      for (const e of cfg.extraRecipients) emails.add(e);
    }
    if (emails.size === 0) return { sent: false, reason: "keine Empfänger" };

    const report = await collectAnomalies();
    if (report.totalCount === 0 && report.activity.projects.length === 0 && !cfg.sendWhenEmpty && !opts.force) {
      return { sent: false, reason: "nichts zu berichten" };
    }

    const bodyHtml = await generateReportText(report);
    const { attachments, cidById } = await loadPhotoThumbnails(report.activity);
    const logoUrl = `${appBase()}/logo.png`;
    const html = buildDailyReportHtml(bodyHtml, report, cidById, logoUrl);
    const text = buildDailyReportText(report);
    const subject = `FLOORTEC Tagesbericht – ${fmtDay(report.dayIso)} (${report.totalCount} Auffälligkeiten)`;

    let anySent = false;
    for (const email of emails) {
      const ok = await sendMailWithAttachments(email, subject, text, html, attachments);
      anySent = anySent || ok;
    }
    return anySent ? { sent: true } : { sent: false, reason: "Versand fehlgeschlagen" };
  } catch (e) {
    console.warn("[daily-report] Fehler:", e instanceof Error ? e.message : e);
    return { sent: false, reason: "Fehler" };
  }
}

/**
 * Prüft die Fälligkeit und versendet den Bericht höchstens einmal pro Kalendertag
 * (lokale Zeit). Wird vom Timer (instrumentation.ts) im 10-Minuten-Raster aufgerufen.
 */
export async function maybeRunDailyReport(): Promise<void> {
  const cfg = await getDailyReportConfig();
  if (!cfg.enabled) return;

  const today = localDateIso();
  if (localHour() < cfg.hour) return; // noch nicht fällig

  const lastSent = await getSetting(DAILY_REPORT_LAST_SENT_KEY);
  if (lastSent === today) return; // heute schon versendet

  // Drossel gegen Dauerschleife bei SMTP-Ausfall: höchstens alle 30 Min ein Versuch.
  const lastAttempt = await getSetting(DAILY_REPORT_LAST_ATTEMPT_KEY);
  const now = Date.now();
  if (lastAttempt) {
    const prev = Number(lastAttempt);
    if (Number.isFinite(prev) && now - prev < 30 * 60 * 1000) return;
  }
  await setSetting(DAILY_REPORT_LAST_ATTEMPT_KEY, String(now));

  const res = await sendDailyReport();
  // Tagesmarker nur bei echtem Versand setzen (sonst am selben Tag später erneut versuchen).
  if (res.sent) await setSetting(DAILY_REPORT_LAST_SENT_KEY, today);
}
