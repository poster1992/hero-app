import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE_NAME = "hero_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 Tage

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not configured");
  }
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  username: string;
  role: string;
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ username: payload.username, role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (typeof payload.username !== "string") return null;
    return {
      username: payload.username,
      role: typeof payload.role === "string" ? payload.role : "",
    };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_MAX_AGE = SESSION_DURATION_SECONDS;
