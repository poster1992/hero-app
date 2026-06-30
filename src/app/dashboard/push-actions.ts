"use server";

import { headers } from "next/headers";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import {
  getVapidPublicKey,
  savePushSubscription,
  deletePushSubscription,
  sendPushToUsers,
  type PushSubscriptionJSON,
} from "@/lib/push";

/** Öffentlicher VAPID-Key (zur Laufzeit, nicht ins Client-Bundle eingebettet). */
export async function getPushPublicKey(): Promise<string | null> {
  return getVapidPublicKey();
}

/** Registriert ein Gerät des angemeldeten Benutzers für Push. */
export async function subscribePushAction(sub: PushSubscriptionJSON): Promise<{ ok: boolean }> {
  const session = await getSession();
  if (!session) return { ok: false };
  const me = await getUserByUsername(session.username);
  if (!me) return { ok: false };
  const ua = (await headers()).get("user-agent");
  try {
    await savePushSubscription(me.id, sub, ua);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Meldet ein Gerät wieder ab. */
export async function unsubscribePushAction(endpoint: string): Promise<{ ok: boolean }> {
  if (!(await getSession())) return { ok: false };
  try {
    await deletePushSubscription(endpoint);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Sendet eine Test-Benachrichtigung an alle Geräte des angemeldeten Benutzers. */
export async function sendTestPushAction(): Promise<{ ok: boolean }> {
  const session = await getSession();
  if (!session) return { ok: false };
  const me = await getUserByUsername(session.username);
  if (!me) return { ok: false };
  await sendPushToUsers([me.id], {
    title: "FLOORTEC – Test",
    body: "Push-Benachrichtigungen funktionieren ✅",
    url: "/dashboard/aufgaben",
    tag: "test",
  });
  return { ok: true };
}
