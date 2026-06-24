"use client";

import { useEffect, useRef } from "react";
import { logout } from "@/app/login/actions";

/** Inaktivitäts-Limit: nach so langer Zeit ohne Interaktion wird abgemeldet. */
const IDLE_LIMIT_MS = 15 * 60 * 1000; // 15 Minuten
/** Wie oft geprüft wird, ob das Limit überschritten ist. */
const CHECK_INTERVAL_MS = 15 * 1000;
/** Schreib-Drosselung für localStorage (Aktivität wird nicht häufiger gespeichert). */
const WRITE_THROTTLE_MS = 10 * 1000;
/** Geteilter Zeitstempel der letzten Aktivität – tab-übergreifend via localStorage. */
const LAST_ACTIVITY_KEY = "hero_last_activity";
/** Grund der Abmeldung, von der Login-Seite ausgelesen. */
const LOGOUT_REASON_KEY = "hero_logout_reason";

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "click",
] as const;

/**
 * Meldet den Nutzer automatisch ab, wenn er länger als IDLE_LIMIT_MS nicht aktiv
 * war (keine Maus-/Tastatur-/Scroll-/Touch-Interaktion). Aktivität wird in
 * localStorage geteilt, sodass das Limit über alle offenen Tabs hinweg gilt und
 * auch ein Reload den Timer nicht zurücksetzt.
 */
export default function IdleLogout() {
  const lastWriteRef = useRef(0);
  const loggingOutRef = useRef(false);

  useEffect(() => {
    const now = () => Date.now();

    const readLastActivity = (): number => {
      const raw = localStorage.getItem(LAST_ACTIVITY_KEY);
      const ts = raw ? parseInt(raw, 10) : NaN;
      return Number.isFinite(ts) ? ts : now();
    };

    const markActivity = () => {
      const t = now();
      // Drosseln: nicht bei jedem mousemove schreiben.
      if (t - lastWriteRef.current < WRITE_THROTTLE_MS) return;
      lastWriteRef.current = t;
      localStorage.setItem(LAST_ACTIVITY_KEY, String(t));
    };

    const doLogout = () => {
      if (loggingOutRef.current) return;
      loggingOutRef.current = true;
      try {
        sessionStorage.setItem(LOGOUT_REASON_KEY, "timeout");
      } catch {
        // sessionStorage kann in seltenen Fällen blockiert sein – egal.
      }
      // Server-Action löscht das httpOnly-Cookie und leitet auf /login um.
      // Fällt sie aus (z.B. Netzwerk), trotzdem hart zur Login-Seite.
      logout().catch(() => {
        window.location.href = "/login";
      });
    };

    const check = () => {
      if (loggingOutRef.current) return;
      if (now() - readLastActivity() >= IDLE_LIMIT_MS) doLogout();
    };

    // Beim Start: war der Nutzer schon zu lange weg (z.B. Tab lag offen, Reload)?
    if (!localStorage.getItem(LAST_ACTIVITY_KEY)) {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(now()));
      lastWriteRef.current = now();
    } else {
      check();
    }

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, markActivity, { passive: true });
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    const interval = window.setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, markActivity);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.clearInterval(interval);
    };
  }, []);

  return null;
}
