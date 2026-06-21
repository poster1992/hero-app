"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

const PREVIEW_COOKIE = "preview_role";

/**
 * Sets (or clears with null) the role an administrator previews the UI as.
 * Only administrators may do this; previewing their own role clears it.
 */
export async function setPreviewRole(role: string | null): Promise<void> {
  const session = await getSession();
  if (session?.role !== "administrator") return;

  const c = await cookies();
  if (role && role !== "administrator") {
    c.set(PREVIEW_COOKIE, role, { path: "/", sameSite: "lax" });
  } else {
    c.delete(PREVIEW_COOKIE);
  }
  revalidatePath("/", "layout");
}
