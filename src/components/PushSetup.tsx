"use client";

import { useEffect, useState } from "react";
import {
  getPushPublicKey,
  subscribePushAction,
  unsubscribePushAction,
  sendTestPushAction,
} from "@/app/dashboard/push-actions";

type State =
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

export default function PushSetup() {
  const [state, setState] = useState<State>("loading");
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
        if (cancelled) return;
        setState(isIOS && !standalone ? "ios-needs-install" : "unsupported");
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

  const enable = async () => {
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
  };

  const disable = async () => {
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
  };

  const test = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await sendTestPushAction();
      setMsg("Test-Benachrichtigung gesendet.");
    } finally {
      setBusy(false);
    }
  };

  if (state === "loading" || state === "unsupported") return null;

  const box = "rounded-xl border border-gray-300 bg-white p-4 shadow-lg shadow-black/10";

  if (state === "ios-needs-install") {
    return (
      <div className={box}>
        <p className="text-sm font-medium text-gray-900">📲 Push am iPhone aktivieren</p>
        <p className="mt-1 text-sm text-gray-600">
          Damit du Mitteilungen erhältst, die App einmalig zum Home-Bildschirm hinzufügen:
          in Safari unten auf <strong>Teilen</strong> → <strong>„Zum Home-Bildschirm"</strong>.
          Danach die App <strong>vom Home-Bildschirm</strong> öffnen und hier „Aktivieren" tippen.
        </p>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className={box}>
        <p className="text-sm text-gray-700">
          🔕 Benachrichtigungen sind blockiert. Bitte in den Einstellungen für diese App/Website
          Mitteilungen erlauben und die Seite neu laden.
        </p>
      </div>
    );
  }

  return (
    <div className={`${box} flex flex-wrap items-center gap-3`}>
      <span className="text-sm text-gray-700">
        {state === "subscribed"
          ? "🔔 Push-Benachrichtigungen sind aktiv."
          : "🔔 Erhalte Mitteilungen bei neuen Aufgaben und Rückmeldungen."}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {state === "subscribed" ? (
          <>
            <button
              type="button"
              onClick={test}
              disabled={busy}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 disabled:opacity-50"
            >
              Test senden
            </button>
            <button
              type="button"
              onClick={disable}
              disabled={busy}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 disabled:opacity-50"
            >
              Deaktivieren
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="rounded-md bg-brand-red px-4 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "…" : "Aktivieren"}
          </button>
        )}
      </div>
      {msg && <span className="w-full text-xs text-gray-500">{msg}</span>}
    </div>
  );
}
