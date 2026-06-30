import "server-only";
import webpush from "web-push";
import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

let configured = false;
/** Initialisiert web-push mit den VAPID-Keys (einmalig). Gibt false, wenn nicht konfiguriert. */
function ensureConfigured(): boolean {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@floortec.design";
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Speichert (oder aktualisiert) eine Push-Subscription für einen Benutzer. */
export async function savePushSubscription(
  userId: number,
  sub: PushSubscriptionJSON,
  ua: string | null
): Promise<void> {
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return;
  await getPool().query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, ua)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth), ua = VALUES(ua)`,
    [userId, sub.endpoint.slice(0, 500), sub.keys.p256dh.slice(0, 255), sub.keys.auth.slice(0, 255), ua?.slice(0, 255) ?? null]
  );
}

/** Entfernt eine Subscription (Abmeldung oder abgelaufen). */
export async function deletePushSubscription(endpoint: string): Promise<void> {
  await getPool().query("DELETE FROM push_subscriptions WHERE endpoint = ?", [endpoint]);
}

interface SubRow extends RowDataPacket {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/** Sendet eine Push-Nachricht an alle Geräte der angegebenen Benutzer (best-effort). */
export async function sendPushToUsers(userIds: number[], payload: PushPayload): Promise<void> {
  const ids = [...new Set(userIds)].filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length === 0 || !ensureConfigured()) return;
  const [rows] = await getPool().query<SubRow[]>(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN (${ids.map(() => "?").join(",")})`,
    ids
  );
  if (rows.length === 0) return;
  const data = JSON.stringify(payload);
  await Promise.all(
    rows.map(async (r) => {
      try {
        await webpush.sendNotification(
          { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
          data
        );
      } catch (e) {
        // 404/410 → Subscription ist tot, entfernen.
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          await deletePushSubscription(r.endpoint).catch(() => {});
        }
      }
    })
  );
}
