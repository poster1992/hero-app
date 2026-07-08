import Link from "next/link";
import {
  getEmployeeUtilization,
  getPlanboardWeek,
  getPlanboardDay,
  mondayOf,
} from "@/lib/planning-data";
import { getProjects } from "@/lib/hero-api";
import UtilizationTable from "@/components/UtilizationTable";
import PlanboardCalendar from "@/components/PlanboardCalendar";
import PlanboardDay from "@/components/PlanboardDay";
import ProjectPlanningSearch, { type ProjectOption } from "@/components/ProjectPlanningSearch";

const BASE_PATH = "/dashboard/planung";
const WEEKS = 8;

// Auslastungstabelle vorerst ausgeblendet (Code bleibt erhalten für späteren
// Wiedereinbau). Zum Reaktivieren auf `true` setzen.
const SHOW_UTILIZATION = false;

type PlanView = "week" | "day";

function parseOffset(value: string | undefined): number {
  const parsed = value ? parseInt(value, 10) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Build a query string, keeping all navigation params (only non-defaults emitted). */
function href(o: number, view: PlanView, w: number, d: number): string {
  const qs = new URLSearchParams();
  if (o !== 0) qs.set("o", String(o));
  if (view === "day") qs.set("view", "day");
  if (w !== 0) qs.set("w", String(w));
  if (d !== 0) qs.set("d", String(d));
  const s = qs.toString();
  return s ? `${BASE_PATH}?${s}` : BASE_PATH;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

const dateRange = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });

export default async function PlanungPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const offset = parseOffset(single(params.o));
  const weekOffset = parseOffset(single(params.w));
  const dayOffset = parseOffset(single(params.d));
  const view: PlanView = single(params.view) === "day" ? "day" : "week";

  const startMonday = addDays(mondayOf(new Date()), offset * WEEKS * 7);
  const endSunday = addDays(startMonday, WEEKS * 7 - 1);

  // Plantafel: week view shows one week (?w=), day view shows one day (?d=).
  const planMonday = addDays(mondayOf(new Date()), weekOffset * 7);
  const planSunday = addDays(planMonday, 6);
  const todayMidnight = new Date(
    Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate()
    )
  );
  const planDay = addDays(todayMidnight, dayOffset);

  let data: Awaited<ReturnType<typeof getEmployeeUtilization>> | null = null;
  let error: string | null = null;
  if (SHOW_UTILIZATION) {
    try {
      data = await getEmployeeUtilization(startMonday, WEEKS);
    } catch (e) {
      error = e instanceof Error ? e.message : "Unbekannter Fehler beim Laden der Daten.";
    }
  }

  let projects: ProjectOption[] = [];
  try {
    projects = (await getProjects()).map((p) => ({
      id: p.id,
      relativeId: p.relativeId,
      name: p.name,
      customerName: p.customerName,
    }));
  } catch {
    // Projektsuche ist optional – Fehler hier blockiert die Plantafel nicht.
  }

  let planboard: Awaited<ReturnType<typeof getPlanboardWeek>> | null = null;
  let planDayData: Awaited<ReturnType<typeof getPlanboardDay>> | null = null;
  let planError: string | null = null;
  try {
    if (view === "day") {
      planDayData = await getPlanboardDay(planDay);
    } else {
      planboard = await getPlanboardWeek(planMonday);
    }
  } catch (e) {
    planError = e instanceof Error ? e.message : "Unbekannter Fehler beim Laden der Plantafel.";
  }

  const navBtn =
    "rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900";

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      {projects.length > 0 && <ProjectPlanningSearch projects={projects} />}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Plantafel</h2>
            <p className="mt-1 text-sm text-gray-600">
              {view === "day" ? (
                <>Termine aus HERO · {planDayData?.label ?? ""}</>
              ) : (
                <>
                  Termine aus HERO · {dateRange.format(planMonday)}–
                  {dateRange.format(planSunday)}
                  {planMonday.getUTCFullYear() === planSunday.getUTCFullYear()
                    ? ` ${planMonday.getUTCFullYear()}`
                    : ""}
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Woche / Tag umschalten */}
            <div className="flex items-center gap-1 rounded-md border border-gray-300 p-0.5">
              <Link
                href={href(offset, "week", weekOffset, dayOffset)}
                className={`rounded px-2.5 py-1 text-sm font-medium transition-colors ${
                  view === "week"
                    ? "bg-brand-red text-white"
                    : "text-gray-700 hover:text-gray-900"
                }`}
              >
                Woche
              </Link>
              <Link
                href={href(offset, "day", weekOffset, dayOffset)}
                className={`rounded px-2.5 py-1 text-sm font-medium transition-colors ${
                  view === "day"
                    ? "bg-brand-red text-white"
                    : "text-gray-700 hover:text-gray-900"
                }`}
              >
                Tag
              </Link>
            </div>

            {view === "day" ? (
              <>
                <Link href={href(offset, "day", weekOffset, dayOffset - 1)} className={navBtn}>
                  ← Tag
                </Link>
                {dayOffset !== 0 && (
                  <Link href={href(offset, "day", weekOffset, 0)} className={navBtn}>
                    Heute
                  </Link>
                )}
                <Link href={href(offset, "day", weekOffset, dayOffset + 1)} className={navBtn}>
                  Tag →
                </Link>
              </>
            ) : (
              <>
                <Link href={href(offset, "week", weekOffset - 1, dayOffset)} className={navBtn}>
                  ← Woche
                </Link>
                {weekOffset !== 0 && (
                  <Link href={href(offset, "week", 0, dayOffset)} className={navBtn}>
                    Diese Woche
                  </Link>
                )}
                <Link href={href(offset, "week", weekOffset + 1, dayOffset)} className={navBtn}>
                  Woche →
                </Link>
              </>
            )}
          </div>
        </div>

        {planError && (
          <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
            Fehler beim Laden der Plantafel von HERO: {planError}
          </div>
        )}

        {view === "day"
          ? planDayData && (
              <PlanboardDay data={planDayData} backUrl={href(offset, view, weekOffset, dayOffset)} />
            )
          : planboard && (
              <PlanboardCalendar week={planboard} backUrl={href(offset, view, weekOffset, dayOffset)} />
            )}
      </section>

      {/* Auslastungstabelle vorerst ausgeblendet (SHOW_UTILIZATION). Code bleibt
          erhalten für späteren Wiedereinbau. */}
      {SHOW_UTILIZATION && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-gray-300 pt-6">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Geplante Stunden</h2>
              <p className="mt-1 text-sm text-gray-600">
                Auslastung je Mitarbeiter ·{" "}
                {dateRange.format(startMonday)}–{dateRange.format(endSunday)}
                {startMonday.getUTCFullYear() === endSunday.getUTCFullYear()
                  ? ` ${startMonday.getUTCFullYear()}`
                  : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link href={href(offset - 1, view, weekOffset, dayOffset)} className={navBtn}>
                ← Früher
              </Link>
              {offset !== 0 && (
                <Link href={href(0, view, weekOffset, dayOffset)} className={navBtn}>
                  Heute
                </Link>
              )}
              <Link href={href(offset + 1, view, weekOffset, dayOffset)} className={navBtn}>
                Später →
              </Link>
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
              Fehler beim Laden der Daten von HERO: {error}
            </div>
          )}

          {data && <UtilizationTable data={data} />}
        </section>
      )}
    </div>
  );
}
