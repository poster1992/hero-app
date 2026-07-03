"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "./Logo";
import PushBell from "@/components/PushBell";
import { logout } from "@/app/login/actions";

interface NavChild {
  href: string;
  label: string;
  /** Optionales Recht; ohne Angabe folgt der Punkt dem Elternmodul. */
  module?: string;
}

interface NavItem {
  href: string;
  label: string;
  icon: string;
  module: string;
  children?: NavChild[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "home", module: "dashboard" },
  { href: "/dashboard/projekte", label: "Projekte", icon: "projekte", module: "projekte" },
  {
    href: "/dashboard/dokumente",
    label: "Dokumente",
    icon: "dokumente",
    module: "dokumente",
    children: [
      { href: "/dashboard/dokumente/angebote", label: "Angebote" },
      { href: "/dashboard/dokumente/auftraege", label: "Aufträge" },
      { href: "/dashboard/dokumente/rechnungen", label: "Rechnungen" },
    ],
  },
  { href: "/dashboard/lager", label: "Lager", icon: "lager", module: "lager" },
  { href: "/dashboard/kunden", label: "Kunden", icon: "kunden", module: "kunden" },
  { href: "/dashboard/aufgaben", label: "Aufgaben", icon: "aufgaben", module: "aufgaben" },
  {
    href: "/dashboard/cockpit",
    label: "Cockpit",
    icon: "dashboard",
    module: "cockpit",
    children: [
      { href: "/dashboard/cockpit", label: "Unternehmensübersicht", module: "cockpit_uebersicht" },
      { href: "/dashboard/aktivitaet", label: "Aktivitäts-Logbuch", module: "cockpit_aktivitaet" },
      { href: "/dashboard/planung", label: "Arbeitsplanung", module: "cockpit_planung" },
      { href: "/dashboard/belege", label: "Belege", module: "cockpit_belege" },
      { href: "/dashboard/lohn-abschlaege", label: "Lohn Abschläge erstellen", module: "cockpit_lohn" },
      { href: "/dashboard/benzin", label: "Benzin / Tankkosten", module: "cockpit_benzin" },
      { href: "/dashboard/rechnungen", label: "Rechnungen", module: "cockpit_rechnungen" },
      { href: "/dashboard/arbeitszeiten", label: "Arbeitszeiten", module: "cockpit_arbeitszeiten" },
      { href: "/dashboard/abc-analyse", label: "ABC-Analyse", module: "cockpit_abc" },
      { href: "/dashboard/preisvergleich", label: "Preisvergleich", module: "cockpit_preisvergleich" },
      { href: "/dashboard/artikel-auswertung", label: "Artikel-Auswertung", module: "cockpit_artikel" },
      { href: "/dashboard/bestellliste", label: "Bestellliste", module: "cockpit_bestellliste" },
      { href: "/dashboard/mitarbeiterbewertung", label: "Mitarbeiterbewertung", module: "cockpit_mitarbeiterbewertung" },
      { href: "/dashboard/arbeitsvertrag", label: "Arbeitsvertrag erstellen", module: "cockpit_arbeitsvertrag" },
    ],
  },
  {
    href: "/dashboard/benutzer",
    label: "Konfiguration",
    icon: "konfiguration",
    module: "konfiguration",
    children: [
      { href: "/dashboard/benutzer", label: "Benutzer anlegen" },
      { href: "/dashboard/gruppen", label: "Benutzergruppen" },
      { href: "/dashboard/workflows", label: "Workflows" },
      { href: "/dashboard/einstellungen", label: "Einstellungen" },
    ],
  },
  { href: "/dashboard/hilfe", label: "Hilfe", icon: "hilfe", module: "hilfe" },
];

/** Monochrome Icons (folgen der Textfarbe via currentColor). */
function NavIcon({ name }: { name: string }) {
  const common = {
    className: "h-5 w-5 shrink-0",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
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
    case "hilfe":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 113.5 2.3c-.8.4-1 1-1 1.7" />
          <path d="M12 16.5h.01" />
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
    default:
      return null;
  }
}

const STORAGE_KEY = "sidebar-collapsed";

export default function Sidebar({
  allowedModules,
  taskNotifCount = 0,
}: {
  allowedModules: string[];
  taskNotifCount?: number;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({});
  // Kindpunkte nach eigenem Recht filtern (ohne Recht folgen sie dem Elternmodul).
  const navItems = NAV_ITEMS.map((item) => ({
    ...item,
    children: item.children?.filter((c) => !c.module || allowedModules.includes(c.module)),
  })).filter((item) => {
    // Cockpit ist ein reiner Container: sichtbar, sobald mindestens ein Unterpunkt freigegeben ist.
    if (item.module === "cockpit") return (item.children?.length ?? 0) > 0;
    return allowedModules.includes(item.module);
  });

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  };

  return (
    <>
      {/* Mobile Topbar mit Hamburger (nur < md) – Safe-Area oben (iOS Notch/Statusleiste) */}
      <div
        className="sticky top-0 z-30 flex items-center gap-3 border-b border-neutral-800 bg-black px-4 pb-3 md:hidden"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Menü öffnen"
          className="flex h-9 w-9 items-center justify-center rounded-md text-gray-200 transition-colors hover:bg-white/10"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <Link href="/start" title="Zur Modulübersicht" className="flex items-center">
          <Logo />
        </Link>
      </div>

      {/* Backdrop (nur mobil, wenn Drawer offen) */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] shrink-0 transform flex-col overflow-y-auto bg-black text-gray-200 transition-transform duration-200 md:sticky md:top-0 md:z-auto md:h-screen md:max-w-none md:translate-x-0 md:border-r md:border-neutral-800 md:transition-[width] ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "md:w-16" : "md:w-72"}`}
      >
        {/* Kopfzeile: Logo + Ein-/Ausklappen (Safe-Area oben für iOS-Drawer) */}
        <div
          className={`relative flex items-center px-3 pb-5 pt-5 md:pt-5 ${
            collapsed ? "md:flex-col md:justify-center md:gap-2" : "justify-center"
          }`}
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)" }}
        >
          <Link href="/start" title="Zur Modulübersicht" className="flex items-center">
            {collapsed ? (
              <span className="hidden h-8 w-8 items-center justify-center rounded-md bg-brand-red text-sm font-bold text-white md:flex">
                F
              </span>
            ) : (
              <Logo />
            )}
          </Link>
          {/* Schließen (nur mobil) */}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Menü schließen"
            className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-white/10 hover:text-white md:hidden"
          >
            ✕
          </button>
          {/* Ein-/Ausklappen (nur ab md) */}
          <button
            type="button"
            onClick={toggle}
            title={collapsed ? "Menü ausklappen" : "Menü einklappen"}
            aria-label={collapsed ? "Menü ausklappen" : "Menü einklappen"}
            className={`hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-white/10 hover:text-white md:flex ${
              collapsed ? "" : "absolute right-3 top-1/2 -translate-y-1/2"
            }`}
          >
            {collapsed ? "›" : "‹"}
          </button>
        </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        {navItems.map((item) => {
          const selfActive =
            item.href === "/dashboard" ? pathname === item.href : pathname?.startsWith(item.href);
          const childActiveAny =
            item.children?.some((c) => pathname?.startsWith(c.href)) ?? false;
          const active = selfActive || childActiveAny;
          const hasChildren = !!item.children?.length;
          const isOpen = openMenus[item.href] ?? active;
          const showChildren = !collapsed && hasChildren && isOpen;
          const badge = item.module === "aufgaben" ? taskNotifCount : 0;

          const rowClass = `flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            collapsed ? "md:justify-center" : "justify-start text-left"
          } ${
            active
              ? "bg-white/10 font-medium text-white"
              : "text-gray-300 hover:bg-white/10 hover:text-white"
          }`;

          return (
            <div key={item.href}>
              {hasChildren ? (
                <button
                  type="button"
                  title={item.label}
                  onClick={() =>
                    setOpenMenus((p) => ({ ...p, [item.href]: !(p[item.href] ?? active) }))
                  }
                  className={rowClass}
                >
                  <NavIcon name={item.icon} />
                  <span className={collapsed ? "md:hidden" : ""}>{item.label}</span>
                  {!collapsed && (
                    <svg
                      className={`ml-auto h-4 w-4 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
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
                  )}
                </button>
              ) : (
                <Link
                  href={item.href}
                  title={item.label}
                  onClick={() => setMobileOpen(false)}
                  className={rowClass}
                >
                  <span className="relative flex shrink-0">
                    <NavIcon name={item.icon} />
                    {badge > 0 && collapsed && (
                      <span className="absolute -right-1 -top-1 hidden h-2.5 w-2.5 rounded-full bg-brand-red ring-2 ring-black md:block" />
                    )}
                  </span>
                  <span className={collapsed ? "md:hidden" : ""}>{item.label}</span>
                  {badge > 0 && (
                    <span
                      className={`ml-auto min-w-[1.25rem] rounded-full bg-brand-red px-1.5 py-0.5 text-center text-[10px] font-semibold leading-none text-white ${
                        collapsed ? "md:hidden" : ""
                      }`}
                    >
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </Link>
              )}

              {showChildren && (
                <div className="mt-1 ml-6 flex flex-col gap-0.5 border-l border-white/10 pl-3">
                  {item.children!.map((child) => {
                    const childActive = pathname?.startsWith(child.href);
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        onClick={() => setMobileOpen(false)}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                          childActive
                            ? "bg-white/10 font-medium text-white"
                            : "text-gray-400 hover:bg-white/5 hover:text-white"
                        }`}
                      >
                        <span className="text-xs">›</span>
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-3 py-3">
        <PushBell collapsed={collapsed} />
        <form action={logout}>
          <button
            type="submit"
            title="Abmelden"
            aria-label="Abmelden"
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-white/10 hover:text-white ${
              collapsed ? "md:justify-center" : "w-full justify-start"
            }`}
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3" />
              <path d="M10 17l-5-5 5-5M5 12h11" />
            </svg>
            <span className={collapsed ? "md:hidden" : ""}>Abmelden</span>
          </button>
        </form>
      </div>
      </aside>
    </>
  );
}
