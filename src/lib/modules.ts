// App areas ("modules") used for per-role permissions. Client-safe (no DB).
// Note: 'konfiguration' is intentionally NOT grantable – it stays admin-only.

export interface AppModule {
  key: string;
  label: string;
}

export const MODULES: AppModule[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "projekte", label: "Projekte" },
  { key: "dokumente", label: "Dokumente" },
  { key: "lager", label: "Lager" },
  { key: "lager_ek", label: "Lager EK-Preise (sehen & pflegen)" },
  { key: "kunden", label: "Kunden" },
  { key: "aufgaben", label: "Aufgaben" },
  { key: "ueberfaellige_aufgaben", label: "Überfällige Aufgaben (Unternehmen)" },
  { key: "cockpit", label: "Cockpit (Arbeitsplanung, Belege, Rechnungen, …)" },
  { key: "rechnungspruefung", label: "Rechnungsprüfung (Belege prüfen)" },
  { key: "ki", label: "KI-Assistent (Chat-Widget)" },
  { key: "hilfe", label: "Hilfe" },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);
