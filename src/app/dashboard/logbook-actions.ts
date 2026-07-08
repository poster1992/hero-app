"use server";

import { heroGraphQL } from "@/lib/hero-api";
import { getSession } from "@/lib/session";
import { listUsers } from "@/lib/users";

/** Aktive Mitarbeiter (für die Aufgaben-Zuweisung im Logbuch). */
export async function listAssignableUsers(): Promise<{ id: number; name: string }[]> {
  if (!(await getSession())) return [];
  try {
    const users = await listUsers();
    return users
      .filter((u) => u.isActive)
      .map((u) => ({ id: u.id, name: u.displayName || u.username }));
  } catch {
    return [];
  }
}

export interface LogbookEntry {
  id: number;
  date: string | null;
  title: string;
  text: string;
  author: string | null;
}

function stripHtml(s: string | null): string {
  if (!s) return "";
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .trim();
}

/** Titel automatischer System-Ereignisse (für die „Nur Notizen"-Ansicht ausgeblendet). */
const SYSTEM_TITLE_RE =
  /hochgeladen|eingetragen|zugewiesen|erstellt|geändert|geaendert|^status:|eingegangen|gelöscht|geloescht|verschoben|storniert|abgeschlossen/i;

/**
 * Loads a project's logbook entries (newest first).
 *
 * HERO-Eigenheit: `show_system_histories: false` liefert das KOMPLETTE
 * Aktivitäts-Log (Bild hochgeladen, Angebot erstellt, Zeiten, Kommentare …),
 * `true` nur eine kleine Teilmenge. Wir holen daher immer das komplette Log.
 * includeSystem=false blendet die automatischen System-Ereignisse aus und
 * zeigt nur die manuellen Notizen/Kommentare.
 */
export async function getProjectLogbook(projectId: number, includeSystem = true): Promise<LogbookEntry[]> {
  const data = await heroGraphQL<{
    project_histories: {
      id: number;
      created: string | null;
      custom_title: string | null;
      custom_text: string | null;
      user: { partner: { name: string | null } | null; email: string | null } | null;
    }[];
  }>(
    `query Logbook($id: Int) {
      project_histories(project_match_id: $id, show_system_histories: false, orderBy: "id", first: 2000) {
        id
        created
        custom_title
        custom_text
        user { partner { name } email }
      }
    }`,
    { id: projectId }
  );
  let entries = (data.project_histories ?? []).map((h) => ({
    id: h.id,
    date: h.created,
    title: stripHtml(h.custom_title),
    text: stripHtml(h.custom_text),
    author: h.user?.partner?.name || h.user?.email || null,
  }));
  entries.reverse(); // neueste zuerst (Query liefert aufsteigend nach id)
  if (!includeSystem) {
    entries = entries.filter((e) => !SYSTEM_TITLE_RE.test(e.title));
  }
  return entries;
}

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

/**
 * Übergreifendes Aktivitäts-Logbuch über ALLE Projekte/Dokumente (neueste zuerst).
 * Nutzt die globale HERO-`histories`-Query.
 */
export async function getGlobalLogbook(limit = 200): Promise<GlobalLogEntry[]> {
  if (!(await getSession())) return [];
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
  // HERO liefert bei last:N absteigend (neueste zuerst).
  return (data.histories ?? []).map((h) => ({
    id: h.id,
    date: h.created,
    title: stripHtml(h.custom_title),
    text: stripHtml(h.custom_text),
    author: h.author_name?.trim() || h.user?.partner?.name || h.user?.email || null,
    projectId: h.target_project_match?.id ?? null,
    projectRelativeId: h.target_project_match?.relative_id ?? null,
    projectName: h.target_project_match?.name ?? null,
  }));
}

export interface AddLogbookResult {
  ok: boolean;
  message: string;
  entry?: LogbookEntry;
}

/** Adds a logbook entry (note) to a project. Writes to HERO. */
export async function addLogbookEntry(
  projectId: number,
  text: string
): Promise<AddLogbookResult> {
  const note = text.trim();
  if (!note) return { ok: false, message: "Bitte einen Text eingeben." };
  try {
    const data = await heroGraphQL<{
      add_logbook_entry: {
        id: number;
        created: string | null;
        custom_title: string | null;
        custom_text: string | null;
        user: { partner: { name: string | null } | null; email: string | null } | null;
      } | null;
    }>(
      `mutation AddLog($entry: LogbookEntryInput!) {
        add_logbook_entry(logbook_entry: $entry) {
          id
          created
          custom_title
          custom_text
          user { partner { name } email }
        }
      }`,
      { entry: { target: "project_match", target_id: projectId, custom_text: note } }
    );
    const h = data.add_logbook_entry;
    if (!h) return { ok: false, message: "HERO hat keinen Eintrag zurückgegeben." };
    return {
      ok: true,
      message: "Eintrag gespeichert.",
      entry: {
        id: h.id,
        date: h.created,
        title: stripHtml(h.custom_title),
        text: stripHtml(h.custom_text) || note,
        author: h.user?.partner?.name || h.user?.email || null,
      },
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Unbekannter Fehler." };
  }
}
