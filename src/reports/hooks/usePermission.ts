/**
 * usePermission hook — Checks if the current user has a specific permission.
 * Integrates with the application's RBAC system.
 */

import { useContext } from "react";
import { useTranslations } from "next-intl";
import { AuthContext } from "@/app/[locale]/(app)/auth-context";
import { hasPermission, type Permission } from "@/server/authz/permissions";

export function usePermission(permission: Permission): boolean {
  const { user } = useContext(AuthContext);
  if (!user) return false;
  return hasPermission(user.role, permission);
}

export function usePermissions(permissions: Permission[]): boolean[] {
  const { user } = useContext(AuthContext);
  if (!user) return new Array(permissions.length).fill(false);
  return permissions.map((perm) => hasPermission(user.role, perm));
}