import "server-only";

// Dünner Microsoft-Graph-Client für den Outlook-Posteingang-Agenten. Nutzt den
// Client-Credentials-Flow (Application Permission `Mail.ReadWrite`, admin-konsentiert
// in Azure AD) – läuft unbeaufsichtigt im Hintergrund-Timer, ohne Nutzer-Login.

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

interface TokenCache {
  token: string;
  expiresAt: number; // ms epoch
}
let tokenCache: TokenCache | null = null;

async function getAccessToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.token;

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Azure-AD-Anmeldung fehlgeschlagen (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return tokenCache.token;
}

async function graphFetch(
  cfg: { tenantId: string; clientId: string; clientSecret: string },
  path: string,
  init?: RequestInit
): Promise<unknown> {
  const token = await getAccessToken(cfg.tenantId, cfg.clientId, cfg.clientSecret);
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Graph-Anfrage fehlgeschlagen (${res.status} ${path}): ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export interface GraphAuth {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface OutlookMessage {
  id: string;
  subject: string | null;
  receivedDateTime: string;
  from: { emailAddress: { name: string | null; address: string | null } } | null;
}

/** Neue Mails mit Anhang seit `sinceIso` im Posteingang (älteste zuerst). */
export async function listCandidateMessages(
  auth: GraphAuth,
  mailbox: string,
  sinceIso: string
): Promise<OutlookMessage[]> {
  const filter = encodeURIComponent(`hasAttachments eq true and receivedDateTime ge ${sinceIso}`);
  const select = "id,subject,receivedDateTime,from";
  const path = `/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages?$filter=${filter}&$select=${select}&$orderby=receivedDateTime asc&$top=50`;
  const data = (await graphFetch(auth, path)) as { value: OutlookMessage[] };
  return data.value ?? [];
}

export interface OutlookFileAttachment {
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
  contentBytes: string; // base64
}

/** Nur echte Datei-Anhänge (keine eingebetteten Mail-Elemente/Referenzen) mit Inhalt. */
export async function listFileAttachments(
  auth: GraphAuth,
  mailbox: string,
  messageId: string
): Promise<OutlookFileAttachment[]> {
  const select = "id,name,contentType,size,isInline,contentBytes";
  const path = `/users/${encodeURIComponent(mailbox)}/messages/${messageId}/attachments?$select=${select}`;
  const data = (await graphFetch(auth, path)) as {
    value: Array<{
      "@odata.type"?: string;
      name?: string;
      contentType?: string;
      size?: number;
      isInline?: boolean;
      contentBytes?: string;
    }>;
  };
  return (data.value ?? [])
    .filter((a) => a["@odata.type"] === "#microsoft.graph.fileAttachment" && a.contentBytes)
    .map((a) => ({
      name: a.name || "Anhang",
      contentType: a.contentType || "application/octet-stream",
      size: a.size ?? 0,
      isInline: !!a.isInline,
      contentBytes: a.contentBytes!,
    }));
}

const processedFolderIdCache: Map<string, string> = new Map();

/** Liefert die ID des Unterordners „Verarbeitet" im Posteingang (legt ihn bei Bedarf an). */
async function getProcessedFolderId(auth: GraphAuth, mailbox: string): Promise<string> {
  const cached = processedFolderIdCache.get(mailbox);
  if (cached) return cached;

  const filter = encodeURIComponent("displayName eq 'Verarbeitet'");
  const listPath = `/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/childFolders?$filter=${filter}`;
  const found = (await graphFetch(auth, listPath)) as { value: Array<{ id: string }> };
  if (found.value && found.value[0]) {
    processedFolderIdCache.set(mailbox, found.value[0].id);
    return found.value[0].id;
  }

  const createPath = `/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/childFolders`;
  const created = (await graphFetch(auth, createPath, {
    method: "POST",
    body: JSON.stringify({ displayName: "Verarbeitet" }),
  })) as { id: string };
  processedFolderIdCache.set(mailbox, created.id);
  return created.id;
}

/** Verschiebt eine verarbeitete Mail aus dem Posteingang in „Verarbeitet". */
export async function moveMessageToProcessedFolder(
  auth: GraphAuth,
  mailbox: string,
  messageId: string
): Promise<void> {
  const destinationId = await getProcessedFolderId(auth, mailbox);
  await graphFetch(auth, `/users/${encodeURIComponent(mailbox)}/messages/${messageId}/move`, {
    method: "POST",
    body: JSON.stringify({ destinationId }),
  });
}

/** Prüft die Azure-AD-Anmeldung + Postfach-Zugriff (für den Test-Button in den Einstellungen). */
export async function verifyOutlookAccess(auth: GraphAuth, mailbox: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await graphFetch(auth, `/users/${encodeURIComponent(mailbox)}/mailFolders/inbox?$select=id`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Verbindungsfehler." };
  }
}
