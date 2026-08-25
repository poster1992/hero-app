"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initialState: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm border border-line-2 bg-white shadow-sm">
        {/* Rote Signal-Kante (Datenblatt-Akzent) */}
        <div className="h-1 w-full bg-brand-red" />
        <div className="flex flex-col gap-5 px-8 py-9">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center bg-brand-red text-2xl font-extrabold text-white">
              F
            </span>
            <div>
              <div className="text-xl font-extrabold tracking-[0.05em] text-ink">FLOORTEC</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
                Dashboard · Junglinster
              </div>
            </div>
          </div>

          <form action={formAction} className="flex w-full flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="username" className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                Benutzername
              </label>
              <input
                id="username"
                name="username"
                type="text"
                required
                autoComplete="username"
                className="border border-line-2 bg-white px-3 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-brand-red"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                Passwort
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="border border-line-2 bg-white px-3 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-brand-red"
              />
            </div>
            {state?.error && (
              <p className="text-sm text-brand-red" aria-live="polite">
                {state.error}
              </p>
            )}
            <button
              type="submit"
              disabled={pending}
              className="mt-1 bg-brand-red px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-red-dark disabled:opacity-60"
            >
              {pending ? "Anmelden …" : "Anmelden"}
            </button>
          </form>

          <p className="text-center font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            FLOORTEC S.à r.l.
          </p>
        </div>
      </div>
    </div>
  );
}
