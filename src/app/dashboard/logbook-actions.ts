"use server";

import { heroGraphQL } from "@/lib/hero-api";

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

/** Loads a project's logbook entries (newest first). */
export async function getProjectLogbook(projectId: number): Promise<LogbookEntry[]> {
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
      project_histories(project_match_id: $id, show_system_histories: false, orderBy: "id", first: 100) {
        id
        created
        custom_title
        custom_text
        user { partner { name } email }
      }
    }`,
    { id: projectId }
  );
  const entries = (data.project_histories ?? []).map((h) => ({
    id: h.id,
    date: h.created,
    title: stripHtml(h.custom_title),
    text: stripHtml(h.custom_text),
    author: h.user?.partner?.name || h.user?.email || null,
  }));
  return entries.reverse();
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
