import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getAllowedModules } from "@/lib/role-store";
import {
  listInsuranceDocuments,
  INSURANCE_CATEGORIES,
  type InsuranceDocument,
} from "@/lib/insurance-docs";
import InsuranceDocuments from "@/components/InsuranceDocuments";

export default async function VersicherungenPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const user = await getUserByUsername(session.username);
  if (!user) redirect("/login");
  const allowed = await getAllowedModules(user.role);
  if (!allowed.includes("cockpit_versicherungen")) redirect("/dashboard");

  let docs: InsuranceDocument[] = [];
  let error: string | null = null;
  try {
    docs = await listInsuranceDocuments();
  } catch (e) {
    error = e instanceof Error ? e.message : "Unterlagen konnten nicht geladen werden.";
  }

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Versicherungen</h1>
        <p className="mt-1 text-sm text-gray-600">
          Versicherungsunterlagen ablegen und verwalten – Flottenverträge, Haftpflicht-, Gebäude- und weitere
          Policen. Dokumente werden nach Kategorie gruppiert.
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-700">{error}</div>
      ) : (
        <InsuranceDocuments docs={docs} categories={INSURANCE_CATEGORIES} />
      )}
    </div>
  );
}
