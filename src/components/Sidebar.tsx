"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "./Logo";
import { logout } from "@/app/login/actions";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
  children?: { href: string; label: string }[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "home" },
  { href: "/dashboard/projekte", label: "Projekte", icon: "projekte" },
  {
    href: "/dashboard/dokumente",
    label: "Dokumente",
    icon: "dokumente",
    children: [
      { href: "/dashboard/dokumente/angebote", label: "Angebote" },
      { href: "/dashboard/dokumente/auftraege", label: "Aufträge" },
      { href: "/dashboard/dokumente/rechnungen", label: "Rechnungen" },
    ],
  },
  { href: "/dashboard/lager", label: "Lager", icon: "lager" },
  { href: "/dashboard/kunden", label: "Kunden", icon: "kunden" },
  { href: "/dashboard/aufgaben", label: "Aufgaben", icon: "aufgaben" },
  {
    href: "/dashboard/cockpit",
    label: "Cockpit",
    icon: "dashboard",
    children: [
      { href: "/dashboard/belege", label: "Belege" },
      { href: "/dashboard/rechnungen", label: "Rechnungen" },
      { href: "/dashboard/arbeitszeiten", label: "Arbeitszeiten" },
      { href: "/dashboard/abc-analyse", label: "ABC-Analyse" },
    ],
  },
  { href: "/dashboard/planung", label: "Arbeitsplanung", icon: "auslastung" },
  {
    href: "/dashboard/benutzer",
    label: "Konfiguration",
    icon: "konfiguration",
    adminOnly: true,
    children: [{ href: "/dashboard/benutzer", label: "Benutzer anlegen" }],
  },
  { href: "/dashboard/hilfe", label: "Hilfe", icon: "hilfe" },
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

export default function Sidebar({ role }: { role?: string }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const navItems = NAV_ITEMS.filter((item) => !item.adminOnly || role === "administrator");

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
    <aside
      className={`relative flex w-full shrink-0 flex-col border-b border-gray-200 bg-white transition-[width] duration-200 md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r ${
        collapsed ? "md:w-16" : "md:w-48"
      }`}
    >
      {/* Kleiner Pfeil am Rand zum Ein-/Ausklappen */}
      <button
        type="button"
        onClick={toggle}
        title={collapsed ? "Menü ausklappen" : "Menü einklappen"}
        aria-label={collapsed ? "Menü ausklappen" : "Menü einklappen"}
        className="absolute -right-3 top-8 z-20 hidden h-6 w-6 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-500 shadow-sm transition-colors hover:border-brand-red/50 hover:text-brand-red md:flex"
      >
        {collapsed ? "›" : "‹"}
      </button>
      <Link
        href="/start"
        title="Zur Modulübersicht"
        className={`flex items-center px-3 py-5 ${collapsed ? "md:justify-center" : "justify-start"}`}
      >
        {collapsed ? (
          <span className="hidden h-8 w-8 items-center justify-center rounded-md bg-brand-red text-sm font-bold text-white md:flex">
            F
          </span>
        ) : (
          <Logo />
        )}
      </Link>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        {navItems.map((item) => {
          const selfActive =
            item.href === "/dashboard" ? pathname === item.href : pathname?.startsWith(item.href);
          const childActiveAny =
            item.children?.some((c) => pathname?.startsWith(c.href)) ?? false;
          const active = selfActive || childActiveAny;
          const showChildren = !collapsed && item.children && active;

          return (
            <div key={item.href}>
              <Link
                href={item.href}
                title={item.label}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  collapsed ? "md:justify-center" : "justify-start text-left"
                } ${
                  active
                    ? "bg-brand-red/10 text-brand-red ring-1 ring-brand-red/30"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <NavIcon name={item.icon} />
                <span className={collapsed ? "md:hidden" : ""}>{item.label}</span>
              </Link>

              {showChildren && (
                <div className="mt-1 ml-9 flex flex-col gap-1">
                  {item.children!.map((child) => {
                    const childActive = pathname?.startsWith(child.href);
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                          childActive
                            ? "bg-brand-red/10 font-medium text-brand-red"
                            : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
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

      <div className="border-t border-gray-200 px-3 py-3">
        <form action={logout}>
          <button
            type="submit"
            title="Abmelden"
            aria-label="Abmelden"
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-gray-600 transition-colors hover:bg-gray-100 hover:text-brand-red ${
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
          </button>
        </form>
      </div>
    </aside>
  );
}
