import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import ArbeitsvertragForm from "@/components/ArbeitsvertragForm";

export default async function ArbeitsvertragPage() {
  if (!(await getSession())) redirect("/login");

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Arbeitsvertrag erstellen</h1>
        <p className="mt-1 text-sm text-gray-600">
          Felder ausfüllen – die Vorlage wird live personalisiert. Anschließend „Drucken / als PDF
          speichern".
        </p>
      </header>

      <ArbeitsvertragForm />
    </div>
  );
}
