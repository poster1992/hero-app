import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getSetting,
  GOOGLE_REVIEW_URL_KEY,
  SMTP_HOST_KEY,
  SMTP_PORT_KEY,
  SMTP_USER_KEY,
  SMTP_PASS_KEY,
  SMTP_FROM_KEY,
} from "@/lib/settings";
import SettingsForm from "@/components/SettingsForm";

export default async function EinstellungenPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "administrator") {
    return (
      <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
        <h1 className="text-2xl font-semibold text-gray-900">Einstellungen</h1>
        <p className="text-sm text-gray-500">Nur für Administratoren.</p>
      </div>
    );
  }

  let googleReviewUrl = "";
  const smtp = { host: "", port: "587", user: "", from: "", passSet: false };
  try {
    const [g, host, port, user, from, pass] = await Promise.all([
      getSetting(GOOGLE_REVIEW_URL_KEY),
      getSetting(SMTP_HOST_KEY),
      getSetting(SMTP_PORT_KEY),
      getSetting(SMTP_USER_KEY),
      getSetting(SMTP_FROM_KEY),
      getSetting(SMTP_PASS_KEY),
    ]);
    googleReviewUrl = g ?? "";
    smtp.host = host ?? "";
    smtp.port = port ?? "587";
    smtp.user = user ?? "";
    smtp.from = from ?? "";
    smtp.passSet = !!(pass && pass.length);
  } catch {
    /* leer lassen */
  }

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Einstellungen</h1>
        <p className="mt-1 text-sm text-gray-600">Allgemeine Konfiguration des Dashboards.</p>
      </header>
      <SettingsForm googleReviewUrl={googleReviewUrl} smtp={smtp} />
    </div>
  );
}
