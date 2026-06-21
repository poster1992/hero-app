"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { createUser, setUserActive } from "@/lib/users";
import { isValidRole } from "@/lib/roles";

const PATH = "/dashboard/benutzer";

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
  if (!isValidRole(role)) {
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

export async function setActiveAction(formData: FormData): Promise<void> {
  if (!(await ensureAdmin())) return;
  const id = Number(formData.get("id"));
  const active = String(formData.get("active")) === "1";
  if (Number.isFinite(id)) {
    await setUserActive(id, active);
    revalidatePath(PATH);
  }
}
