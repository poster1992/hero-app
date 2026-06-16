"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_COOKIE_MAX_AGE } from "@/lib/auth";

export interface LoginState {
  error?: string;
}

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const username = formData.get("username");
  const password = formData.get("password");

  if (typeof username !== "string" || typeof password !== "string") {
    return { error: "Bitte Benutzername und Passwort angeben." };
  }

  const expectedUsername = process.env.APP_USERNAME;
  const expectedHash = process.env.APP_PASSWORD_HASH;

  if (!expectedUsername || !expectedHash) {
    return { error: "Login ist nicht konfiguriert." };
  }

  if (username !== expectedUsername) {
    return { error: "Benutzername oder Passwort ist falsch." };
  }

  const passwordMatches = await bcrypt.compare(password, expectedHash);
  if (!passwordMatches) {
    return { error: "Benutzername oder Passwort ist falsch." };
  }

  const token = await createSessionToken({ username });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE,
  });

  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  redirect("/login");
}
