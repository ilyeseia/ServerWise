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
  // Hardware catalog, suppliers and price observations (Stage 4).
  "catalog:read",
  "catalog:write",
  /** Confirm or reject a recorded price. Owner only: it is the check on what staff enter. */
  "catalog:verify",
  // Quotations (Stage 5). Pricing configuration is governed by settings:read / settings:update.
  "quote:read",
  "quote:write",
  /** Freeze a draft into an issued revision the customer can receive. */
  "quote:issue",
  /** Record the customer's answer (accepted / rejected) on an issued revision. */
  "quote:decide",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  sales: [
    "dashboard:view",
    "settings:read",
    "crm:read",
    "crm:write",
    "catalog:read",
    "catalog:write",
    "quote:read",
    "quote:write",
    "quote:issue",
    "quote:decide",
  ],
  technician: [
    "dashboard:view",
    "settings:read",
    "crm:read",
    "catalog:read",
    "catalog:write",
    "quote:read",
  ],
  viewer: ["dashboard:view"],
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** True only for a known role that explicitly holds the permission. */
export function can(role: unknown, permission: Permission): boolean {
  return isRole(role) && ROLE_PERMISSIONS[role].includes(permission);
}
