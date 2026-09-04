import { redirect } from "next/navigation";
import { getSession, getEffectiveRole } from "@/lib/session";
import { getAllowedModules } from "@/lib/role-store";
import { getProjectPipeline } from "@/lib/hero-api";
import { listBaustellen } from "@/lib/baustellen-docs";
import { countReviewEmailsSent } from "@/lib/review-emails";
import { getGoogleReviewStats } from "@/lib/google-reviews";
import ProjectPipelines from "@/components/ProjectPipelines";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const { role } = await getEffectiveRole();
  const allowedModules = await getAllowedModules(role);

  // Benutzergruppe „Lager" soll direkt in der Lager-Seite landen und gar nicht erst
  // das (für sie irrelevante) Dashboard sehen.
  // Hinweis: redirect() wirft NEXT_REDIRECT – NICHT in try/catch aufrufen.
  if (role === "lager" && allowedModules.includes("lager")) {
    redirect("/dashboard/lager");
  }

  // Reine Foto-Benutzer (Baustellen-Zugriff, aber kein Dashboard-Recht – z. B. die
  // Rolle „bauleiter"/Projekt Fotos) sollen nicht auf dem für sie leeren Dashboard
  // landen, sondern direkt in ihrer ersten Baustellen-Galerie.
  // Hinweis: redirect() wirft NEXT_REDIRECT – NICHT in try/catch aufrufen.
  if (!allowedModules.includes("dashboard") && allowedModules.includes("baustellen")) {
    let firstBaustelleId: number | null = null;
    try {
      const baustellen = await listBaustellen();
      firstBaustelleId = baustellen[0]?.id ?? null;
    } catch {
      // Ohne Baustellen-Liste bleibt es beim normalen Dashboard.
    }
    if (firstBaustelleId !== null) redirect(`/dashboard/baustellen/${firstBaustelleId}`);
  }

  let pipeline: Awaited<ReturnType<typeof getProjectPipeline>> | null = null;
  try {
    pipeline = await getProjectPipeline();
  } catch {
    // Pipeline ist optional – Fehler hier blockiert das Dashboard nicht.
  }

  // Per Rechteverteilung ein-/ausblendbare Kennzahlen (wie im Cockpit).
  const showBewertungen = allowedModules.includes("dashboard_bewertungen");
  const year = new Date().getUTCFullYear();
  let reviewsSentTotal = 0;
  let reviewsSentYear = 0;
  let googleStats: Awaited<ReturnType<typeof getGoogleReviewStats>> = {
    rating: null,
    count: null,
    configured: false,
    error: undefined,
  };
  if (showBewertungen) {
    try {
      [reviewsSentTotal, reviewsSentYear] = await Promise.all([
        countReviewEmailsSent(),
        countReviewEmailsSent(year),
      ]);
    } catch {
      // Zähler optional
    }
    googleStats = await getGoogleReviewStats().catch(() => googleStats);
  }

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      <header className="border-b-2 border-brand-red pb-2.5">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Dashboard</h1>
      </header>

      {showBewertungen && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:max-w-3xl">
          <div className="border border-line bg-white p-5">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
              Zufriedenheitsumfragen versendet
            </p>
            <p className="mt-2 text-3xl font-extrabold tracking-tight tabular-nums text-ink">
              {reviewsSentTotal}
              <span className="ml-2 font-mono text-sm font-normal text-muted">gesamt</span>
            </p>
            <p className="mt-1 font-mono text-[11px] text-muted">davon {reviewsSentYear} in {year}</p>
          </div>
          <div className="border border-line bg-white p-5">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">Google-Rezensionen</p>
            {googleStats.configured && googleStats.count != null ? (
              <>
                <p className="mt-2 text-3xl font-extrabold tracking-tight tabular-nums text-ink">
                  {googleStats.count}
                  <span className="ml-2 font-mono text-sm font-normal text-muted">Rezensionen</span>
                </p>
                <p className="mt-1 font-mono text-[11px] text-muted">
                  {googleStats.rating != null
                    ? `Ø ${googleStats.rating.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ★`
                    : "—"}
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 text-3xl font-extrabold tracking-tight text-faint">—</p>
                {googleStats.configured && googleStats.error ? (
                  <p className="mt-1 max-w-[220px] font-mono text-[11px] text-brand-red" title={googleStats.error}>
                    {googleStats.error}
                  </p>
                ) : (
                  <p className="mt-1 font-mono text-[11px] text-faint">unter Einstellungen konfigurieren</p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {pipeline && (
        <div className="border border-line bg-white p-5">
          <h2 className="mb-4 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Projekt-Pipeline</h2>
          <ProjectPipelines pipeline={pipeline} />
        </div>
      )}
    </div>
  );
}
