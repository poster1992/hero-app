"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";
import Logo from "@/components/Logo";

const initialState: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      {/* Hintergrundbild + dunkle Überlagerung für Lesbarkeit */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/login-bg.png')" }}
        aria-hidden
      />
      <div
        className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/90 to-black"
        aria-hidden
      />

      <div className="relative w-full max-w-sm rounded-xl border border-neutral-300 bg-neutral-200/95 p-8 shadow-lg shadow-black/40 backdrop-blur">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="username" className="text-sm font-medium text-neutral-700">
              Benutzername
            </label>
            <input
              id="username"
              name="username"
              type="text"
              required
              autoComplete="username"
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-brand-red focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-sm font-medium text-neutral-700">
              Passwort
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-brand-red focus:outline-none"
            />
          </div>
          {state?.error && (
            <p className="text-sm text-red-600" aria-live="polite">
              {state.error}
            </p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="mt-2 rounded-md bg-brand-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-red-dark disabled:opacity-60"
          >
            {pending ? "Anmelden..." : "Anmelden"}
          </button>
        </form>
      </div>
    </div>
  );
}
