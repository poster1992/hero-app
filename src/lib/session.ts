import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken, type SessionPayload } from "./auth";

/** The current logged-in session (server-side), or null. */
export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** True if the current session is an administrator. */
export async function isAdmin(): Promise<boolean> {
  const session = await getSession();
  return session?.role === "administrator";
}
