"use client";

import { usePush } from "@/components/usePush";

const IOS_HINT =
  "Push am iPhone aktivieren:\n\n" +
  "1. In Safari unten auf Teilen -> 'Zum Home-Bildschirm'.\n" +
  "2. Die App vom Home-Bildschirm-Icon oeffnen.\n" +
  "3. Hier erneut tippen und Mitteilungen erlauben.";

/** Kompakter Mitteilungen-Schalter für die Sidebar (global verfügbar). */
export default function PushBell({ collapsed }: { collapsed: boolean }) {
  const { state, busy, enable, disable } = usePush();

  if (state === "loading" || state === "unsupported") return null;

  const active = state === "subscribed";
  const label = active ? "Mitteilungen an" : "Mitteilungen";

  const onClick = () => {
    if (active) return void disable();
    if (state === "default") return void enable();
    if (state === "ios-needs-install") return void window.alert(IOS_HINT);
    if (state === "denied")
      return void window.alert(
        "Benachrichtigungen sind blockiert. Bitte in den Einstellungen für diese App Mitteilungen erlauben."
      );
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={active ? "Mitteilungen aktiv – zum Deaktivieren tippen" : "Mitteilungen aktivieren"}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50 ${
        active ? "text-emerald-300" : "text-gray-300"
      } ${collapsed ? "md:justify-center" : "w-full justify-start"}`}
    >
      <span className="relative">
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
          <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 01-3.4 0" />
        </svg>
        {active && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400" />
        )}
      </span>
      <span className={collapsed ? "md:hidden" : ""}>{label}</span>
    </button>
  );
}
