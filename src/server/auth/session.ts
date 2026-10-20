import { getAuth } from "@/server/auth";
import type { Actor } from "@/server/authz/guard";
import { isRole } from "@/server/authz/permissions";

export interface SessionInfo {
  actor: Actor;
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
}

/**
 * Resolves the signed-in user from request headers. Returns null for no session, banned users
 * and users whose role is unknown (deny by default).
 */
export async function getSessionInfo(headers: Headers): Promise<SessionInfo | null> {
  const session = await getAuth().api.getSession({ headers });
  if (!session) return null;

  const user = session.user as typeof session.user & {
    role?: string | null;
    banned?: boolean | null;
    mustChangePassword?: boolean | null;
    twoFactorEnabled?: boolean | null;
  };
  if (user.banned || !isRole(user.role)) return null;

  return {
    actor: { id: user.id, email: user.email, name: user.name, role: user.role },
    mustChangePassword: user.mustChangePassword === true,
    twoFactorEnabled: user.twoFactorEnabled === true,
  };
}

export type AccessGate = "ok" | "change-password" | "enroll-2fa";

/**
 * Decides whether a signed-in user may use the application yet. A temporary password must be
 * changed first; owners must have two-factor authentication when the policy requires it.
 */
export function accessGate(
  info: SessionInfo,
  options: { require2faForOwner: boolean },
): AccessGate {
  if (info.mustChangePassword) return "change-password";
  if (options.require2faForOwner && info.actor.role === "owner" && !info.twoFactorEnabled) {
    return "enroll-2fa";
  }
  return "ok";
}
