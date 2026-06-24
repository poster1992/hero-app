"use client";

import { useActionState, useEffect, useState } from "react";
import { login, type LoginState } from "./actions";

const initialState: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);
  const [timedOut, setTimedOut] = useState(false);

  // Hinweis zeigen, wenn die letzte Sitzung wegen Inaktivität beendet wurde.
  useEffect(() => {
    try {
      if (sessionStorage.getItem("hero_logout_reason") === "timeout") {
        setTimedOut(true);
        sessionStorage.removeItem("hero_logout_reason");
      }
    } catch {
      // sessionStorage nicht verfügbar – Hinweis einfach weglassen.
    }
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-10 bg-black px-4">
      <div className="text-3xl font-semibold tracking-[0.3em] text-white">FLOORTEC</div>

      {timedOut && (
        <p className="-mb-6 max-w-sm text-center text-sm text-amber-400" aria-live="polite">
          Du wurdest wegen 15 Minuten Inaktivität automatisch abgemeldet. Bitte erneut anmelden.
        </p>
      )}

      <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="username" className="text-sm font-medium text-white/70">
            Benutzername
          </label>
          <input
            id="username"
            name="username"
            type="text"
            required
            autoComplete="username"
            className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-brand-red"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium text-white/70">
            Passwort
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-brand-red"
          />
        </div>
        {state?.error && (
          <p className="text-sm text-red-400" aria-live="polite">
            {state.error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Anmelden …" : "Anmelden"}
        </button>
      </form>
    </div>
  );
}
