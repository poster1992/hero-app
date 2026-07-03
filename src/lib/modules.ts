// App areas ("modules") used for per-role permissions. Client-safe (no DB).
// Note: 'konfiguration' is intentionally NOT grantable – it stays admin-only.

export interface AppModule {
  key: string;
  label: string;
  /** Optional grouping in the permissions matrix (e.g. Cockpit sub-items). */
  group?: string;
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
  { key: "rechnungspruefung", label: "Rechnungsprüfung (Belege prüfen)" },
  { key: "ki", label: "KI-Assistent (Chat-Widget)" },
  { key: "hilfe", label: "Hilfe" },

  // Cockpit – einzelne Menüpunkte getrennt freigebbar.
  { key: "cockpit_uebersicht", label: "Unternehmensübersicht", group: "Cockpit" },
  { key: "cockpit_aktivitaet", label: "Aktivitäts-Logbuch", group: "Cockpit" },
  { key: "cockpit_planung", label: "Arbeitsplanung", group: "Cockpit" },
  { key: "cockpit_belege", label: "Belege (voller Zugriff)", group: "Cockpit" },
  { key: "cockpit_belege_basis", label: "Belege – eingeschränkt (nur Checkliste, Belegliste & Suche)", group: "Cockpit" },
  { key: "cockpit_lohn", label: "Lohn Abschläge erstellen", group: "Cockpit" },
  { key: "cockpit_benzin", label: "Benzin / Tankkosten", group: "Cockpit" },
  { key: "cockpit_rechnungen", label: "Rechnungen", group: "Cockpit" },
  { key: "cockpit_arbeitszeiten", label: "Arbeitszeiten", group: "Cockpit" },
  { key: "cockpit_abc", label: "ABC-Analyse", group: "Cockpit" },
  { key: "cockpit_preisvergleich", label: "Preisvergleich", group: "Cockpit" },
  { key: "cockpit_artikel", label: "Artikel-Auswertung", group: "Cockpit" },
  { key: "cockpit_bestellliste", label: "Bestellliste", group: "Cockpit" },
  { key: "cockpit_mitarbeiterbewertung", label: "Mitarbeiterbewertung", group: "Cockpit" },
  { key: "cockpit_arbeitsvertrag", label: "Arbeitsvertrag erstellen", group: "Cockpit" },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);

/** Alle Cockpit-Untermodule (für „mind. ein Cockpit-Punkt sichtbar"-Prüfungen). */
export const COCKPIT_MODULE_KEYS = MODULES.filter((m) => m.group === "Cockpit").map((m) => m.key);
