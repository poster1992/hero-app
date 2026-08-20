"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { createUser, setUserActive, setUserPassword, setUserRole, setUserHeroToken, listUsers } from "@/lib/users";
import { roleExists } from "@/lib/role-store";

const PATH = "/dashboard/benutzer";

/** Erzeugt ein zufälliges, gut lesbares Passwort (ohne verwechselbare Zeichen). */
function generatePassword(): string {
  const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
  const DIGIT = "23456789";
  const SYM = "!@#$%*";
  const pick = (set: string, n: number) => Array.from({ length: n }, () => set[randomInt(set.length)]).join("");
  const chars = (pick(ALPHA, 5) + pick(DIGIT, 2) + pick(SYM, 1)).split("");
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  const core = chars.join("");
  return core.slice(0, 4) + "-" + core.slice(4);
}

export interface CredentialResult {
  ok: boolean;
  error?: string;
  username?: string;
  displayName?: string;
  role?: string;
  password?: string;
}

/**
 * Setzt für einen Benutzer ein NEUES zufälliges Passwort und gibt die Zugangsdaten
 * zurück (für das PDF). Das alte Passwort wird dabei ersetzt (Klartext ist sonst
 * nicht verfügbar – es liegt nur als Hash vor).
 */
export async function generateCredentialsAction(formData: FormData): Promise<CredentialResult> {
  if (!(await ensureAdmin())) return { ok: false, error: "Kein Zugriff." };
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "Ungültige ID." };
  const user = (await listUsers()).find((u) => u.id === id);
  if (!user) return { ok: false, error: "Benutzer nicht gefunden." };
  const password = generatePassword();
  try {
    await setUserPassword(id, password);
  } catch {
    return { ok: false, error: "Passwort konnte nicht gesetzt werden." };
  }
  return {
    ok: true,
    username: user.username,
    displayName: user.displayName ?? user.username,
    role: user.role,
    password,
  };
}

export interface CreateUserState {
  error?: string;
  success?: string;
}

async function ensureAdmin(): Promise<boolean> {
  const session = await getSession();
  return session?.role === "administrator";
}

export async function createUserAction(
  _prev: CreateUserState,
  formData: FormData
): Promise<CreateUserState> {
  if (!(await ensureAdmin())) return { error: "Kein Zugriff." };

  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;

  if (!username || !password) {
    return { error: "Benutzername und Passwort sind erforderlich." };
  }
  if (password.length < 4) {
    return { error: "Das Passwort muss mindestens 4 Zeichen haben." };
  }
  if (!(await roleExists(role))) {
    return { error: "Bitte eine gültige Rolle wählen." };
  }
  if (email && !email.includes("@")) {
    return { error: "Bitte eine gültige E-Mail-Adresse angeben." };
  }

  try {
    await createUser({ username, password, role, displayName, email });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ER_DUP_ENTRY") {
      return { error: "Dieser Benutzername existiert bereits." };
    }
    return { error: "Benutzer konnte nicht angelegt werden." };
  }

  revalidatePath(PATH);
  return { success: `Benutzer „${username}" wurde angelegt.` };
}

export interface PasswordState {
  error?: string;
  success?: string;
}

export async function setPasswordAction(
  _prev: PasswordState,
  formData: FormData
): Promise<PasswordState> {
  if (!(await ensureAdmin())) return { error: "Kein Zugriff." };

  const id = Number(formData.get("id"));
  const password = String(formData.get("password") ?? "");

  if (!Number.isFinite(id)) return { error: "Ungültiger Benutzer." };
  if (password.length < 4) {
    return { error: "Mind. 4 Zeichen." };
  }

  try {
    await setUserPassword(id, password);
  } catch {
    return { error: "Passwort konnte nicht gesetzt werden." };
  }

  revalidatePath(PATH);
  return { success: "Passwort gesetzt." };
}

export interface RoleState {
  error?: string;
  success?: string;
}

export async function setRoleAction(
  _prev: RoleState,
  formData: FormData
): Promise<RoleState> {
  const session = await getSession();
  if (session?.role !== "administrator") return { error: "Kein Zugriff." };

  const id = Number(formData.get("id"));
  const role = String(formData.get("role") ?? "");
  const username = String(formData.get("username") ?? "");

  if (!Number.isFinite(id)) return { error: "Ungültiger Benutzer." };
  if (session.username === username) {
    return { error: "Eigene Rolle nicht änderbar." };
  }
  if (!(await roleExists(role))) {
    return { error: "Ungültige Rolle." };
  }

  try {
    await setUserRole(id, role);
  } catch {
    return { error: "Rolle konnte nicht geändert werden." };
  }

  revalidatePath(PATH);
  return { success: "Rolle geändert." };
}

export interface HeroTokenState {
  error?: string;
  success?: string;
}

/**
 * Setzt (oder löscht bei leerem Feld) den persönlichen HERO-API-Token eines Benutzers.
 * Damit laufen dessen HERO-Aktionen (v.a. Logbuch-Einträge) unter seinem echten
 * HERO-Namen. Nur Admin. Der Token wird nie zurück an den Client gegeben.
 */
export async function setHeroTokenAction(
  _prev: HeroTokenState,
  formData: FormData
): Promise<HeroTokenState> {
  if (!(await ensureAdmin())) return { error: "Kein Zugriff." };
  const id = Number(formData.get("id"));
  const token = String(formData.get("token") ?? "");
  if (!Number.isFinite(id)) return { error: "Ungültiger Benutzer." };
  try {
    await setUserHeroToken(id, token);
  } catch {
    return { error: "Token konnte nicht gespeichert werden." };
  }
  revalidatePath(PATH);
  return { success: token.trim() ? "gespeichert" : "entfernt" };
}

export async function setActiveAction(formData: FormData): Promise<void> {
  if (!(await ensureAdmin())) return;
  const id = Number(formData.get("id"));
  const active = String(formData.get("active")) === "1";
  if (Number.isFinite(id)) {
    await setUserActive(id, active);
    revalidatePath(PATH);
  }
}
