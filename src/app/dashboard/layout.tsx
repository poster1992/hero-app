import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import GlobalSearch from "@/components/GlobalSearch";
import PreviewBanner from "@/components/PreviewBanner";
import DataChatWidget from "@/components/DataChatWidget";
import IdleLogout from "@/components/IdleLogout";
import WorkflowTrigger from "@/components/WorkflowTrigger";
import { getSession, getEffectiveRole } from "@/lib/session";
import { getAllowedModules } from "@/lib/role-store";
import { getUserByUsername } from "@/lib/users";
import { countUnacknowledged } from "@/lib/task-notifications";
import { listBaustellen } from "@/lib/baustellen-docs";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Zentrale Auth-Sperre: ohne gültige Session kommt niemand an Dashboard-Seiten.
  const session = await getSession();
  if (!session) redirect("/login");

  const { role, isPreview } = await getEffectiveRole();
  const allowedModules = await getAllowedModules(role);

  // Anzahl unbestätigter Aufgaben-Meldungen (Badge am Menüpunkt).
  let taskNotifCount = 0;
  try {
    const me = await getUserByUsername(session.username);
    if (me) taskNotifCount = await countUnacknowledged(me.id);
  } catch {
    // optional – ohne Zahl bleibt das Badge einfach aus.
  }

  // Baustellen-Doku-Menüpunkte (in Einstellungen gepflegt).
  let baustellen: { id: number; label: string }[] = [];
  try {
    baustellen = (await listBaustellen()).map((b) => ({ id: b.id, label: b.label }));
  } catch {
    // optional – ohne Einträge bleibt das Menü unverändert.
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <IdleLogout />
      <WorkflowTrigger />
      <Sidebar allowedModules={allowedModules} taskNotifCount={taskNotifCount} baustellen={baustellen} />
      <main className="flex min-w-0 flex-1 flex-col bg-black">
        {isPreview && <PreviewBanner role={role} />}
        <div className="flex items-center justify-center bg-black px-4 pb-2 pt-6">
          <GlobalSearch />
        </div>
        <div className="flex flex-1 flex-col">{children}</div>
      </main>
      {allowedModules.includes("ki") && <DataChatWidget />}
    </div>
  );
}
