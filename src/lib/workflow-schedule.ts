/**
 * Zeitplan-Konstanten für wiederkehrende Aufgaben.
 *
 * Bewusst eine eigene Datei ohne DB-Zugriff: Die Workflow-Oberfläche (Client-Komponente)
 * braucht diese Werte. Lägen sie in `workflows.ts`, zöge der Import dort `lib/db` und
 * damit mysql2 ins Browser-Bundle – der Build bricht dann ab.
 */

/** Wiederholungs-Rhythmus einer wiederkehrenden Aufgabe. */
export const REPEAT_KINDS = [
  { key: "daily", label: "Täglich" },
  { key: "weekly", label: "Wöchentlich (fester Wochentag)" },
  { key: "monthly", label: "Monatlich (fester Tag im Monat)" },
  { key: "interval", label: "Alle N Tage" },
] as const;

export type RepeatKind = (typeof REPEAT_KINDS)[number]["key"];

/** 1 = Montag … 7 = Sonntag (ISO-Zählung). */
export const WEEKDAYS = [
  { key: 1, label: "Montag" },
  { key: 2, label: "Dienstag" },
  { key: 3, label: "Mittwoch" },
  { key: 4, label: "Donnerstag" },
  { key: 5, label: "Freitag" },
  { key: 6, label: "Samstag" },
  { key: 7, label: "Sonntag" },
] as const;
