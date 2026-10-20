import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

/**
 * Access control for Better Auth's own admin endpoints (/admin/*). Only owners hold admin
 * statements. Business permissions live in src/server/authz/permissions.ts.
 */
export const ac = createAccessControl({ ...defaultStatements });

export const authRoles = {
  owner: ac.newRole({ ...adminAc.statements }),
  sales: ac.newRole({}),
  technician: ac.newRole({}),
  viewer: ac.newRole({}),
};
