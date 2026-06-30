"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getPushPublicKey,
  subscribePushAction,
  unsubscribePushAction,
  sendTestPushAction,
} from "@/app/dashboard/push-actions";

export type PushState =
  | "loading"
  | "unsupported"
  | "ios-needs-install"
  | "default"
  | "denied"
  | "subscribed";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/** Gemeinsame Web-Push-Logik (Registrierung, Status, an-/abmelden, Test). */
export function usePush() {
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true;
      const supported =
        "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

      if (!supported) {
        if (!cancelled) setState(isIOS && !standalone ? "ios-needs-install" : "unsupported");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const sub = await reg.pushManager.getSubscription();
        if (cancelled) return;
        if (sub) {
          setState("subscribed");
          return;
        }
      } catch {
        /* ignore */
      }
      if (cancelled) return;
      if (Notification.permission === "denied") setState("denied");
      else if (isIOS && !standalone) setState("ios-needs-install");
      else setState("default");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setMsg("Berechtigung wurde nicht erteilt.");
        setState(perm === "denied" ? "denied" : "default");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const key = await getPushPublicKey();
      if (!key) {
        setMsg("Push ist serverseitig nicht konfiguriert.");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        setMsg("Subscription unvollständig.");
        return;
      }
      const res = await subscribePushAction({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      });
      if (res.ok) {
        setState("subscribed");
        setMsg("Push aktiviert ✅");
      } else {
        setMsg("Konnte nicht gespeichert werden.");
      }
    } catch {
      setMsg("Aktivierung fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribePushAction(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("default");
      setMsg("Push deaktiviert.");
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }, []);

  const test = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      await sendTestPushAction();
      setMsg("Test-Benachrichtigung gesendet.");
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, msg, enable, disable, test };
}
