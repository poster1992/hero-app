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

const PREVIEW_COOKIE = "preview_role";

/**
 * The role to render the UI for. Administrators can preview another role's
 * view via the `preview_role` cookie; everyone else just uses their own role.
 */
export async function getEffectiveRole(): Promise<{
  role: string;
  realRole: string;
  isPreview: boolean;
}> {
  const session = await getSession();
  const realRole = session?.role ?? "";
  const preview = (await cookies()).get(PREVIEW_COOKIE)?.value ?? null;
  if (realRole === "administrator" && preview && preview !== "administrator") {
    return { role: preview, realRole, isPreview: true };
  }
  return { role: realRole, realRole, isPreview: false };
}
