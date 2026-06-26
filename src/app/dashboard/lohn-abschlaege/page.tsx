import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listLohnEmployees, type LohnEmployee } from "@/lib/lohn-employees";
import { getCompanyBankInfo } from "@/lib/hero-api";
import LohnAbschlaegeClient from "@/components/LohnAbschlaegeClient";

export default async function LohnAbschlaegePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let employees: LohnEmployee[] = [];
  let error: string | null = null;
  try {
    employees = await listLohnEmployees(true);
  } catch (e) {
    error = e instanceof Error ? e.message : "Mitarbeiter konnten nicht geladen werden.";
  }

  // Auftraggeber-Bankverbindung (nur Hinweis, ob IBAN vorhanden ist).
  let companyIbanOk = false;
  let companyName: string | null = null;
  try {
    const company = await getCompanyBankInfo();
    companyIbanOk = !!company.iban;
    companyName = company.name;
  } catch {
    // Optional – fehlende Firma blockiert die Mitarbeiterpflege nicht.
  }

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Lohn Abschläge erstellen</h1>
        <p className="mt-1 text-sm text-gray-600">
          Mitarbeiter mit Bankverbindung pflegen, Abschläge erfassen und als
          SEPA-Datei (Multiline) für die Bank exportieren.
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : (
        <LohnAbschlaegeClient
          employees={employees}
          companyIbanOk={companyIbanOk}
          companyName={companyName}
        />
      )}
    </div>
  );
}
