/**
 * Role-based access control matrix. This is the single source of truth: every service checks
 * it on the server. Hiding a button in the UI is cosmetic and never a security control.
 *
 * Add permissions here as modules ship; unknown roles and permissions are always denied.
 * Every change must also be made, on purpose, in the golden table of tests/unit/authz.test.ts.
 */

export const ROLES = ["owner", "sales", "technician", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "dashboard:view",
  "user:read",
  "user:manage",
  "settings:read",
  "settings:update",
  "audit:read",
  // CRM (Stage 3): customers, contacts, leads, follow-ups, communications, requirements.
  "crm:read",
  "crm:write",
  "crm:archive",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  sales: ["dashboard:view", "settings:read", "crm:read", "crm:write"],
  technician: ["dashboard:view", "settings:read", "crm:read"],
  viewer: ["dashboard:view"],
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** True only for a known role that explicitly holds the permission. */
export function can(role: unknown, permission: Permission): boolean {
  return isRole(role) && ROLE_PERMISSIONS[role].includes(permission);
}
