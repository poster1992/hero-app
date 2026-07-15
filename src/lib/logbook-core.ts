import "server-only";
import { heroGraphQL } from "./hero-api";
import { listUsers } from "./users";

/**
 * Geteilte, session-freie Logbuch-Lese-Logik.
 *
 * Bewusst KEIN "use server": Diese Funktionen dürfen NICHT als RPC-Endpunkte
 * exponiert werden. `logbook-actions.ts` ("use server") importiert sie und schützt
 * die Frontend-Aufrufe mit einem Session-Guard. Serverseitige Systemläufe
 * (Cron / Tagesbericht) nutzen `getGlobalLogbookSystem` direkt – ohne Session,
 * über den Firmen-Token (currentHeroToken-Fallback).
 */

export interface GlobalLogEntry {
  id: number;
  date: string | null;
  title: string;
  text: string;
  author: string | null;
  projectId: number | null;
  projectRelativeId: number | null;
  projectName: string | null;
}

export function stripHtml(s: string | null): string {
  if (!s) return "";
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .trim();
}

/** Titel automatischer System-Ereignisse (für die „Nur Notizen"-Ansicht ausgeblendet). */
export const SYSTEM_TITLE_RE =
  /hochgeladen|eingetragen|zugewiesen|erstellt|geändert|geaendert|^status:|eingegangen|gelöscht|geloescht|verschoben|storniert|abgeschlossen/i;

/** Markiert den vorangestellten Autor eindeutig, z.B. "Max Mustermann · ". */
export const AUTHOR_SEP = " · ";

/**
 * Erkennt den vorangestellten Verfasser in einem Logbuch-Text.
 * Nur Namen aus `knownNames` gelten als Autor – so wird kein normaler Text
 * (z.B. "Achtung: …") fälschlich als Autor interpretiert.
 */
export function splitAuthorPrefix(
  text: string,
  knownNames: Set<string>
): { author: string | null; body: string } {
  const idx = text.indexOf(AUTHOR_SEP);
  if (idx > 0 && idx <= 60) {
    const name = text.slice(0, idx).trim();
    if (knownNames.has(name)) return { author: name, body: text.slice(idx + AUTHOR_SEP.length) };
  }
  return { author: null, body: text };
}

/** Menge der bekannten App-Benutzernamen (Anzeigename + Loginname) für die Autor-Erkennung. */
export async function knownUserNames(): Promise<Set<string>> {
  try {
    const users = await listUsers();
    const set = new Set<string>();
    for (const u of users) {
      if (u.displayName?.trim()) set.add(u.displayName.trim());
      if (u.username?.trim()) set.add(u.username.trim());
    }
    return set;
  } catch {
    return new Set();
  }
}

/**
 * Übergreifendes Aktivitäts-Logbuch über ALLE Projekte (neueste zuerst), OHNE
 * Session-Guard. Nur serverseitig verwenden (Cron/Bericht) – nie aus dem Frontend.
 */
export async function getGlobalLogbookSystem(limit = 200): Promise<GlobalLogEntry[]> {
  const data = await heroGraphQL<{
    histories: {
      id: number;
      created: string | null;
      custom_title: string | null;
      custom_text: string | null;
      author_name: string | null;
      target_project_match: { id: number; name: string | null; relative_id: number | null } | null;
      user: { partner: { name: string | null } | null; email: string | null } | null;
    }[];
  }>(
    `query GlobalLog($limit: Int) {
      histories(orderBy: "id", last: $limit) {
        id
        created
        custom_title
        custom_text
        author_name
        target_project_match { id name relative_id }
        user { partner { name } email }
      }
    }`,
    { limit }
  );
  const known = await knownUserNames();
  return (data.histories ?? []).map((h) => {
    const raw = stripHtml(h.custom_text);
    const { author: prefixAuthor, body } = splitAuthorPrefix(raw, known);
    return {
      id: h.id,
      date: h.created,
      title: stripHtml(h.custom_title),
      text: body,
      author: prefixAuthor || h.author_name?.trim() || h.user?.partner?.name || h.user?.email || null,
      projectId: h.target_project_match?.id ?? null,
      projectRelativeId: h.target_project_match?.relative_id ?? null,
      projectName: h.target_project_match?.name ?? null,
    };
  });
}

/**
 * Schreibt eine Logbuch-Notiz an ein Projekt – OHNE Session (für Cron/Workflows).
 * Nutzt die HERO-Mutation `add_logbook_entry` über den Firmen-Token-Fallback
 * (currentHeroToken). Wirft nie; gibt true bei Erfolg zurück.
 */
export async function addProjectLogbookEntry(projectId: number, text: string): Promise<boolean> {
  const note = text.trim();
  if (!projectId || !note) return false;
  try {
    const data = await heroGraphQL<{ add_logbook_entry: { id: number } | null }>(
      `mutation AddLog($entry: LogbookEntryInput!) {
        add_logbook_entry(logbook_entry: $entry) { id }
      }`,
      { entry: { target: "project_match", target_id: projectId, custom_text: note } }
    );
    return !!data.add_logbook_entry?.id;
  } catch {
    return false;
  }
}
