"use server";

import { heroGraphQL } from "@/lib/hero-api";
import { getSession } from "@/lib/session";
import { listUsers, getUserByUsername } from "@/lib/users";
import {
  stripHtml,
  splitAuthorPrefix,
  knownUserNames,
  AUTHOR_SEP,
  SYSTEM_TITLE_RE,
  getGlobalLogbookSystem,
  type GlobalLogEntry,
} from "@/lib/logbook-core";
// Hinweis: GlobalLogEntry NICHT aus dieser "use server"-Datei re-exportieren –
// Typ-Re-Exports brechen den Server-Action-Build. Konsumenten importieren den Typ
// direkt aus "@/lib/logbook-core".

/**
 * Ermittelt für den aktuellen Benutzer, ob und wie sein Name einem Logbuch-Eintrag
 * vorangestellt werden muss.
 *
 * - Hat der Benutzer einen EIGENEN HERO-Token, schreibt HERO ihn bereits als echten
 *   Autor → kein Präfix nötig (`prefix: null`).
 * - Sonst läuft der Eintrag über den Firmen-Token (Autor = Key-Besitzer); dann stellen
 *   wir den Namen voran, damit der echte Verfasser sichtbar bleibt.
 */
async function authorPrefixFor(): Promise<string | null> {
  try {
    const session = await getSession();
    if (!session) return null;
    const user = await getUserByUsername(session.username);
    if (!user) return null;
    if (user.hasHeroToken) return null; // echter HERO-Autor → kein Präfix
    return user.displayName?.trim() || session.username;
  } catch {
    return null;
  }
}

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
  const known = await knownUserNames();
  let entries = (data.project_histories ?? []).map((h) => {
    const raw = stripHtml(h.custom_text);
    const { author: prefixAuthor, body } = splitAuthorPrefix(raw, known);
    return {
      id: h.id,
      date: h.created,
      title: stripHtml(h.custom_title),
      text: body,
      // Vorangestellter App-Verfasser hat Vorrang vor dem HERO-Autor (= Key-Besitzer).
      author: prefixAuthor || h.user?.partner?.name || h.user?.email || null,
    };
  });
  entries.reverse(); // neueste zuerst (Query liefert aufsteigend nach id)
  if (!includeSystem) {
    entries = entries.filter((e) => !SYSTEM_TITLE_RE.test(e.title));
  }
  return entries;
}

/**
 * Übergreifendes Aktivitäts-Logbuch über ALLE Projekte/Dokumente (neueste zuerst).
 * Nur für angemeldete Nutzer; die eigentliche Query liegt in logbook-core.
 */
export async function getGlobalLogbook(limit = 200): Promise<GlobalLogEntry[]> {
  if (!(await getSession())) return [];
  return getGlobalLogbookSystem(limit);
}

export interface AddLogbookResult {
  ok: boolean;
  message: string;
  entry?: LogbookEntry;
}

/** Adds a logbook entry (note) to a project. Writes to HERO. */
export async function addLogbookEntry(
  projectId: number,
  text: string,
  /** false = Autor NICHT voranstellen (für Aufrufer, die den Verfasser schon im Text nennen). */
  prefixAuthor = true
): Promise<AddLogbookResult> {
  const note = text.trim();
  if (!note) return { ok: false, message: "Bitte einen Text eingeben." };

  // Verfasser nur voranstellen, wenn der Benutzer KEINEN eigenen HERO-Token hat
  // (sonst zeigt HERO ihn bereits als echten Autor).
  const author = prefixAuthor ? await authorPrefixFor() : null;
  const body = author ? `${author}${AUTHOR_SEP}${note}` : note;

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
      { entry: { target: "project_match", target_id: projectId, custom_text: body } }
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
        // Im zurückgegebenen Eintrag den Autor-Präfix wieder abtrennen und als Verfasser zeigen.
        text: note,
        author: author || h.user?.partner?.name || h.user?.email || null,
      },
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Unbekannter Fehler." };
  }
}
