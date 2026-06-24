import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import GlobalSearch from "@/components/GlobalSearch";
import PreviewBanner from "@/components/PreviewBanner";
import DataChatWidget from "@/components/DataChatWidget";
import { getSession, getEffectiveRole } from "@/lib/session";
import { getAllowedModules } from "@/lib/role-store";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Zentrale Auth-Sperre: ohne gültige Session kommt niemand an Dashboard-Seiten.
  if (!(await getSession())) redirect("/login");

  const { role, isPreview } = await getEffectiveRole();
  const allowedModules = await getAllowedModules(role);
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar allowedModules={allowedModules} />
      <main className="flex min-w-0 flex-1 flex-col bg-black">
        {isPreview && <PreviewBanner role={role} />}
        <div className="flex items-center justify-center bg-black px-4 pb-2 pt-6">
          <GlobalSearch />
        </div>
        <div className="flex flex-1 flex-col">{children}</div>
      </main>
      <DataChatWidget />
    </div>
  );
}
