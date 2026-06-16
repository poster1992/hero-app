"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";
import Logo from "@/components/Logo";

const initialState: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-800 bg-gray-900/60 p-8 shadow-lg shadow-black/30 backdrop-blur">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <h1 className="mb-6 text-center text-xl font-semibold text-gray-100">
          Dashboard Login
        </h1>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="username" className="text-sm font-medium text-gray-300">
              Benutzername
            </label>
            <input
              id="username"
              name="username"
              type="text"
              required
              autoComplete="username"
              className="rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100 focus:border-brand-red focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-sm font-medium text-gray-300">
              Passwort
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100 focus:border-brand-red focus:outline-none"
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
            className="mt-2 rounded-md bg-brand-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-red-dark disabled:opacity-60"
          >
            {pending ? "Anmelden..." : "Anmelden"}
          </button>
        </form>
      </div>
    </div>
  );
}
