import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorkdays, getTrackingCategories, getProjects, type Workday, type TrackingCategory } from "@/lib/hero-api";
import { getEffectiveRole } from "@/lib/session";
import { getAllowedModules } from "@/lib/role-store";
import WorkdayApproval, { type ProjectOption } from "@/components/WorkdayApproval";

const BASE_PATH = "/dashboard/zeitfreigabe";

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseOffset(value: string | undefined): number {
  const n = value ? parseInt(value, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

/** Montag der Woche, in der `d` liegt (UTC). */
function mondayOf(d: Date): Date {
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (r.getUTCDay() + 6) % 7; // Mo=0 … So=6
  return addDays(r, -day);
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const dateRange = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

export default async function ZeitfreigabePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Zugriff nur mit Modul-Recht (bzw. Administrator).
  const { role } = await getEffectiveRole();
  if (role !== "administrator") {
    const mods = await getAllowedModules(role).catch(() => [] as string[]);
    if (!mods.includes("cockpit_zeitfreigabe")) notFound();
  }

  const params = await searchParams;
  const weekOffset = parseOffset(single(params.w));

  const monday = addDays(mondayOf(new Date()), weekOffset * 7);
  const sunday = addDays(monday, 6);
  const from = iso(monday);
  const to = iso(sunday);

  let workdays: Workday[] = [];
  let categories: TrackingCategory[] = [];
  let projects: ProjectOption[] = [];
  let error: string | null = null;
  try {
    // Kategorien + Projekte für die Bearbeiten-Auswahl (fehlertolerant – ohne sie
    // bleibt die Ansicht read-only, statt ganz zu scheitern).
    const [wd, cats, projs] = await Promise.all([
      getWorkdays(from, to),
      getTrackingCategories().catch(() => [] as TrackingCategory[]),
      getProjects()
        .then((list) => list.map((p) => ({ id: p.id, label: `${p.relativeId ? `#${p.relativeId} ` : ""}${p.name}` })))
        .catch(() => [] as ProjectOption[]),
    ]);
    workdays = wd;
    categories = cats;
    projects = projs;
  } catch (e) {
    error = e instanceof Error ? e.message : "Arbeitszeiten konnten nicht geladen werden.";
  }

  const open = workdays.filter((w) => !w.confirmed).length;

  const weekHref = (o: number) => (o === 0 ? BASE_PATH : `${BASE_PATH}?w=${o}`);

  return (
    <div className="flex w-full max-w-none flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Arbeitszeit-Freigabe</h1>
          <p className="mt-1 text-sm text-gray-600">
            Woche {dateRange.format(monday)} – {dateRange.format(sunday)}
            {!error && ` · ${open} ${open === 1 ? "Tag" : "Tage"} offen`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={weekHref(weekOffset - 1)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-brand-red/50"
          >
            ← Woche
          </Link>
          {weekOffset !== 0 && (
            <Link
              href={BASE_PATH}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-brand-red/50"
            >
              Heute
            </Link>
          )}
          <Link
            href={weekHref(weekOffset + 1)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-brand-red/50"
          >
            Woche →
          </Link>
        </div>
      </header>

      {error ? (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          Fehler beim Laden aus HERO: {error}
        </div>
      ) : workdays.length === 0 ? (
        <div className="rounded-xl border border-gray-300 bg-white p-8 text-center text-sm text-gray-500 shadow-lg shadow-black/10">
          Keine erfassten Arbeitstage in dieser Woche.
        </div>
      ) : (
        <WorkdayApproval
          workdays={workdays}
          from={from}
          to={to}
          categories={categories}
          projects={projects}
        />
      )}
    </div>
  );
}
