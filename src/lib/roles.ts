/** Canonical user roles (mirrors the `roles` table). */
export const ROLES = [
  { key: "administrator", label: "Administrator" },
  { key: "buero", label: "Büro" },
  { key: "monteur", label: "Monteure" },
] as const;

export type RoleKey = (typeof ROLES)[number]["key"];

export function roleLabel(key: string): string {
  return ROLES.find((r) => r.key === key)?.label ?? key;
}

export function isValidRole(key: string): key is RoleKey {
  return ROLES.some((r) => r.key === key);
}
