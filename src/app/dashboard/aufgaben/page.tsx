import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getUserByUsername, listUsers } from "@/lib/users";
import { listTasksAssignedTo, listTasksCreatedBy, listAllOpenTasks } from "@/lib/tasks";
import { getProjects } from "@/lib/hero-api";
import { listReceiptReviews } from "@/lib/receipt-reviews";
import TaskManager, { type ReviewTaskInfo } from "@/components/TaskManager";
import PushSetup from "@/components/PushSetup";

export default async function AufgabenPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const isAdmin = session.role === "administrator";
  let error: string | null = null;
  let me = null;
  let assigned: Awaited<ReturnType<typeof listTasksAssignedTo>> = [];
  let created: Awaited<ReturnType<typeof listTasksCreatedBy>> = [];
  let allOpen: Awaited<ReturnType<typeof listAllOpenTasks>> = [];
  let users: Awaited<ReturnType<typeof listUsers>> = [];
  let projects: { id: number; relativeId: number | null; name: string }[] = [];

  try {
    me = await getUserByUsername(session.username);
    if (me) {
      [assigned, created, users] = await Promise.all([
        listTasksAssignedTo(me.id),
        listTasksCreatedBy(me.id),
        listUsers(),
      ]);
      if (isAdmin) allOpen = await listAllOpenTasks();
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Aufgaben konnten nicht geladen werden.";
  }

  try {
    projects = (await getProjects()).map((p) => ({
      id: p.id,
      relativeId: p.relativeId,
      name: p.name,
    }));
  } catch {
    // Projektliste optional – ohne sie fehlt nur die Projektauswahl.
  }

  // Prüf-Infos je HERO-Beleg-ID (für Prüf-Aufgaben: PDF + Entscheidung).
  const reviewsByHeroId: Record<string, ReviewTaskInfo> = {};
  try {
    const rev = await listReceiptReviews();
    for (const [id, r] of rev) {
      reviewsByHeroId[id] = {
        status: r.status,
        docUrl: r.docUrl,
        number: r.number,
        supplier: r.supplier,
        gross: r.gross,
        reviewedByName: r.reviewedByName,
        note: r.note,
        history: r.history.map((h) => ({
          actionLabel: h.actionLabel,
          detail: h.detail,
          byName: h.byName,
          at: h.at,
        })),
      };
    }
  } catch {
    // Prüf-Infos optional.
  }

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Aufgaben</h1>
        <p className="mt-1 text-sm text-gray-600">
          Aufgaben an Mitarbeiter senden und den Fortschritt verfolgen.
        </p>
      </header>

      <PushSetup />

      {error ? (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : (
        <TaskManager
          assigned={assigned}
          created={created}
          allOpen={allOpen}
          isAdmin={isAdmin}
          users={users.filter((u) => u.isActive).map((u) => ({
            id: u.id,
            name: u.displayName || u.username,
          }))}
          projects={projects}
          meId={me?.id ?? 0}
          reviewsByHeroId={reviewsByHeroId}
        />
      )}
    </div>
  );
}
