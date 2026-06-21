"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_COOKIE_MAX_AGE } from "@/lib/auth";
import { authenticateUser } from "@/lib/users";

export interface LoginState {
  error?: string;
}

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const username = formData.get("username");
  const password = formData.get("password");

  if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
    return { error: "Bitte Benutzername und Passwort angeben." };
  }

  let user: Awaited<ReturnType<typeof authenticateUser>>;
  try {
    user = await authenticateUser(username.trim(), password);
  } catch {
    return { error: "Anmeldung derzeit nicht möglich (Datenbank nicht erreichbar)." };
  }

  if (!user) {
    return { error: "Benutzername oder Passwort ist falsch." };
  }

  const token = await createSessionToken({ username: user.username, role: user.role });
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
