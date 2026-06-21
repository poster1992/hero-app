"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { createRole, deleteRole, setRolePermissions } from "@/lib/role-store";
import { MODULE_KEYS } from "@/lib/modules";

const PATH = "/dashboard/gruppen";

export interface GroupState {
  error?: string;
  success?: string;
}

async function ensureAdmin(): Promise<boolean> {
  const session = await getSession();
  return session?.role === "administrator";
}

export async function createGroupAction(
  _prev: GroupState,
  formData: FormData
): Promise<GroupState> {
  if (!(await ensureAdmin())) return { error: "Kein Zugriff." };
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return { error: "Bitte einen Gruppennamen angeben." };

  const key = await createRole(label);
  if (!key) return { error: "Gruppe existiert bereits oder Name ungültig." };

  revalidatePath(PATH);
  return { success: `Gruppe „${label}“ angelegt.` };
}

export async function deleteGroupAction(formData: FormData): Promise<void> {
  if (!(await ensureAdmin())) return;
  const key = String(formData.get("key") ?? "");
  if (!key) return;
  await deleteRole(key);
  revalidatePath(PATH);
}

/** Saves the module permissions for all listed (non-admin) roles. */
export async function savePermissionsAction(formData: FormData): Promise<void> {
  if (!(await ensureAdmin())) return;
  const roleKeys = String(formData.get("roleKeys") ?? "")
    .split(",")
    .filter(Boolean);
  for (const rk of roleKeys) {
    const mods = MODULE_KEYS.filter((m) => formData.get(`perm__${rk}__${m}`) != null);
    await setRolePermissions(rk, mods);
  }
  revalidatePath(PATH);
}
