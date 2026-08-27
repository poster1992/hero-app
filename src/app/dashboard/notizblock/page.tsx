import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getUserNote } from "@/lib/user-notes";
import Notepad from "@/components/Notepad";

export default async function NotizblockPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const user = await getUserByUsername(session.username);
  if (!user) redirect("/login");

  let content = "";
  let updated: string | null = null;
  let error: string | null = null;
  try {
    const note = await getUserNote(user.id);
    content = note.content;
    updated = note.updated;
  } catch (e) {
    error = e instanceof Error ? e.message : "Notizblock konnte nicht geladen werden.";
  }

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-1 flex-col gap-6 px-6 py-8">
      <header className="border-b-2 border-brand-red pb-2.5">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Notizblock</h1>
        <p className="mt-1 text-sm text-gray-600">Deine persönlichen Notizen – nur für dich sichtbar.</p>
      </header>

      {error ? (
        <div className="border border-brand-red/40 bg-brand-red/10 p-4 text-sm text-brand-red-dark">{error}</div>
      ) : (
        <Notepad initialContent={content} initialUpdated={updated} />
      )}
    </div>
  );
}
