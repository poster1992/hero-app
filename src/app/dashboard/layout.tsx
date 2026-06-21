import Sidebar from "@/components/Sidebar";
import GlobalSearch from "@/components/GlobalSearch";
import { getSession } from "@/lib/session";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar role={session?.role ?? ""} />
      <main className="flex min-w-0 flex-1 flex-col bg-[#d2d2d2]">
        <div className="flex items-center border-b border-gray-300 bg-white px-4 py-2">
          <GlobalSearch />
        </div>
        <div className="flex flex-1 flex-col">{children}</div>
      </main>
    </div>
  );
}
