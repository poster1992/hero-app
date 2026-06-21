import Link from "next/link";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { logout } from "@/app/login/actions";
import { getSession } from "@/lib/session";
import { roleLabel } from "@/lib/roles";

interface ModuleDef {
  href: string;
  label: string;
  description: string;
  icon: string;
  adminOnly?: boolean;
}

const MODULES: ModuleDef[] = [
  { href: "/dashboard", label: "Dashboard", description: "Übersicht", icon: "home" },
  { href: "/dashboard/projekte", label: "Projekte", description: "Projektübersicht & Details", icon: "projekte" },
  { href: "/dashboard/dokumente", label: "Dokumente", description: "Angebote, Aufträge & Rechnungen", icon: "dokumente" },
  { href: "/dashboard/lager", label: "Lager", description: "Lagerverwaltung", icon: "lager" },
  { href: "/dashboard/kunden", label: "Kunden", description: "Kontakte & Adressen", icon: "kunden" },
  { href: "/dashboard/aufgaben", label: "Aufgaben", description: "An Mitarbeiter senden & verfolgen", icon: "aufgaben" },
  { href: "/dashboard/cockpit", label: "Cockpit", description: "Umsätze, Kennzahlen & GuV", icon: "dashboard" },
  { href: "/dashboard/belege", label: "Belege", description: "Eingangs- und Ausgangsbelege", icon: "belege" },
  { href: "/dashboard/rechnungen", label: "Rechnungen", description: "Kundenrechnungen", icon: "rechnungen" },
  { href: "/dashboard/planung", label: "Arbeitsplanung", description: "Plantafel & Projektstunden", icon: "auslastung" },
  { href: "/dashboard/arbeitszeiten", label: "Arbeitszeiten", description: "Erfasste Zeiten", icon: "arbeitszeiten" },
  { href: "/dashboard/abc-analyse", label: "ABC-Analyse", description: "Kunden- & Umsatzklassen", icon: "abc" },
  { href: "/dashboard/benutzer", label: "Konfiguration", description: "Benutzer & Zugänge", icon: "konfiguration", adminOnly: true },
  { href: "/dashboard/hilfe", label: "Hilfe", description: "Erklärungen & Support", icon: "hilfe" },
];

function ModuleIcon({ name }: { name: string }) {
  const common = {
    className: "h-8 w-8",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path d="M3 11l9-7 9 7" />
          <path d="M5 10v10h14V10" />
          <path d="M10 20v-6h4v6" />
        </svg>
      );
    case "dashboard":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    case "belege":
      return (
        <svg {...common}>
          <path d="M6 2h9l3 3v15l-2.5-1.5L13 20l-2.5-1.5L8 20l-2-1.5V2z" />
          <path d="M9 7h6M9 11h6M9 15h4" />
        </svg>
      );
    case "rechnungen":
      return (
        <svg {...common}>
          <rect x="2.5" y="5" width="19" height="14" rx="2" />
          <path d="M14 9.5a2.5 2.5 0 100 5M8 11h4M8 13h4" />
        </svg>
      );
    case "projekte":
      return (
        <svg {...common}>
          <path d="M3 6a2 2 0 012-2h4l2 2.5h8a2 2 0 012 2V18a2 2 0 01-2 2H5a2 2 0 01-2-2V6z" />
        </svg>
      );
    case "auslastung":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="17" rx="2" />
          <path d="M3 9h18M8 2v4M16 2v4M8 13v4M12 12v5M16 14v3" />
        </svg>
      );
    case "arbeitszeiten":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "kunden":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 20a5.5 5.5 0 0111 0" />
          <path d="M16 5.5a3 3 0 010 5.8M16.5 20a5.5 5.5 0 00-3-4.9" />
        </svg>
      );
    case "abc":
      return (
        <svg {...common}>
          <path d="M4 20V4M4 20h16" />
          <path d="M8 20v-6M13 20V9M18 20v-9" />
        </svg>
      );
    case "benutzer":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 20a5.5 5.5 0 0111 0" />
          <path d="M18 8v6M21 11h-6" />
        </svg>
      );
    case "aufgaben":
      return (
        <svg {...common}>
          <rect x="6" y="4" width="12" height="17" rx="2" />
          <path d="M9 4a1.5 1.5 0 011.5-1.5h3A1.5 1.5 0 0115 4M9 12l1.8 1.8L14 10" />
        </svg>
      );
    case "dokumente":
      return (
        <svg {...common}>
          <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
          <path d="M14 3v5h5M9 13h6M9 17h6" />
        </svg>
      );
    case "konfiguration":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h.09a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.09a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      );
    case "lager":
      return (
        <svg {...common}>
          <path d="M3 9l9-5 9 5v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9z" />
          <path d="M3 9h18M8 20v-6h8v6" />
        </svg>
      );
    case "hilfe":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 113.5 2.3c-.8.4-1 1-1 1.7" />
          <path d="M12 16.5h.01" />
        </svg>
      );
    default:
      return null;
  }
}

export default async function StartPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const modules = MODULES.filter((m) => !m.adminOnly || session.role === "administrator");

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar role={session.role ?? ""} />

      <main className="relative flex-1 overflow-hidden bg-black text-gray-100">
        {/* Hintergrundbild + Schleier */}
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('/login-bg.png')" }}
          aria-hidden
        />
        <div
          className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/90 to-black"
          aria-hidden
        />

        <div className="relative z-10">
          <header className="flex items-center justify-end border-b border-white/10 px-8 py-4">
            <div className="flex items-center gap-4">
              <span className="hidden text-sm text-gray-200 sm:inline">
                {session.username}
                {session.role ? ` · ${roleLabel(session.role)}` : ""}
              </span>
              <form action={logout}>
                <button
                  type="submit"
                  className="rounded-md border border-white/40 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:border-brand-red hover:text-brand-red"
                >
                  Abmelden
                </button>
              </form>
            </div>
          </header>

          <div className="mx-auto w-full max-w-6xl px-8 py-10">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {modules.map((m) => (
                <Link
                  key={m.href}
                  href={m.href}
                  className="group flex items-center gap-4 rounded-xl border border-white/10 bg-gray-900/60 p-5 shadow-lg shadow-black/30 backdrop-blur transition-colors hover:border-brand-red/60 hover:bg-gray-900/80"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-brand-red/15 text-brand-red">
                    <ModuleIcon name={m.icon} />
                  </span>
                  <span className="flex flex-col">
                    <span className="text-base font-semibold text-white">{m.label}</span>
                    <span className="mt-0.5 text-sm text-gray-400">{m.description}</span>
                  </span>
                  <svg
                    className="ml-auto h-5 w-5 shrink-0 text-brand-red/70 transition-colors group-hover:text-brand-red"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
