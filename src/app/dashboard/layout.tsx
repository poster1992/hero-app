import Sidebar from "@/components/Sidebar";
import GlobalSearch from "@/components/GlobalSearch";
import PreviewBanner from "@/components/PreviewBanner";
import { getEffectiveRole } from "@/lib/session";
import { getAllowedModules } from "@/lib/role-store";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { role, isPreview } = await getEffectiveRole();
  const allowedModules = await getAllowedModules(role);
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar allowedModules={allowedModules} />
      <main className="flex min-w-0 flex-1 flex-col bg-[#d2d2d2]">
        {isPreview && <PreviewBanner role={role} />}
        <div className="flex items-center border-b border-gray-300 bg-white px-4 py-2">
          <GlobalSearch />
        </div>
        <div className="flex flex-1 flex-col">{children}</div>
      </main>
    </div>
  );
}
