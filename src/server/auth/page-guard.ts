import { notFound } from "next/navigation";
import { RuleViolationError } from "@/server/authz/guard";
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

/** Renders the localized 404 when a service reports that the record does not exist. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof RuleViolationError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
