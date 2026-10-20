import { notFound } from "next/navigation";
import { can, type Permission } from "@/server/authz/permissions";
import { getCurrentSession } from "./current";

/**
 * For server-rendered pages: returns the session when the user holds the permission, otherwise
 * renders the localized 404 (we do not reveal that a page exists). Services re-check anyway.
 */
export async function requirePagePermission(permission: Permission) {
  const session = await getCurrentSession();
  if (!session || !can(session.actor.role, permission)) notFound();
  return session;
}
