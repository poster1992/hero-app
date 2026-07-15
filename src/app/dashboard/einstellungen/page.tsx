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
  GOOGLE_PLACES_API_KEY_KEY,
  GOOGLE_PLACE_ID_KEY,
} from "@/lib/settings";
import SettingsForm from "@/components/SettingsForm";
import BaustellenAdmin from "@/components/BaustellenAdmin";
import { listBaustellen, type BaustelleDoc } from "@/lib/baustellen-docs";

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
  const places = { placeId: "", apiKeySet: false };
  try {
    const [g, host, port, user, from, pass, placeId, apiKey] = await Promise.all([
      getSetting(GOOGLE_REVIEW_URL_KEY),
      getSetting(SMTP_HOST_KEY),
      getSetting(SMTP_PORT_KEY),
      getSetting(SMTP_USER_KEY),
      getSetting(SMTP_FROM_KEY),
      getSetting(SMTP_PASS_KEY),
      getSetting(GOOGLE_PLACE_ID_KEY),
      getSetting(GOOGLE_PLACES_API_KEY_KEY),
    ]);
    googleReviewUrl = g ?? "";
    smtp.host = host ?? "";
    smtp.port = port ?? "587";
    smtp.user = user ?? "";
    smtp.from = from ?? "";
    smtp.passSet = !!(pass && pass.length);
    places.placeId = placeId ?? "";
    places.apiKeySet = !!(apiKey && apiKey.length);
  } catch {
    /* leer lassen */
  }

  let baustellen: BaustelleDoc[] = [];
  try {
    baustellen = await listBaustellen();
  } catch {
    /* leer lassen */
  }

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Einstellungen</h1>
        <p className="mt-1 text-sm text-gray-600">Allgemeine Konfiguration des Dashboards.</p>
      </header>
      <SettingsForm googleReviewUrl={googleReviewUrl} smtp={smtp} places={places} />
      <BaustellenAdmin items={baustellen} />
    </div>
  );
}
