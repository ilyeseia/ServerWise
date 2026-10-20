import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { assertCan, type Actor } from "@/server/authz/guard";
import { logger } from "@/server/logging/logger";

/** Audit action names. Keep them stable: reports and alerts filter on them. */
export const AUDIT_ACTIONS = [
  "auth.login.success",
  "auth.login.failed",
  "auth.login.blocked",
  "auth.lockout",
  "auth.logout",
  "auth.password.changed",
  "auth.password.reset_by_admin",
  "auth.2fa.enroll_started",
  "auth.2fa.enabled",
  "auth.2fa.disabled",
  "auth.2fa.failed",
  "user.created",
  "user.role_changed",
  "user.deactivated",
  "user.reactivated",
  "settings.updated",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Translation key for an action: dots are not allowed in message keys ("a.b" -> "a_b"). */
export type AuditMessageKey<A extends string = AuditAction> = A extends `${infer H}.${infer T}`
  ? `${H}_${AuditMessageKey<T>}`
  : A;

export function auditMessageKey<A extends AuditAction>(action: A): AuditMessageKey<A> {
  return action.replaceAll(".", "_") as AuditMessageKey<A>;
}

export interface AuditEntry {
  action: AuditAction;
  actorId?: string | null;
  actorEmail?: string | null;
  entityType?: string;
  entityId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

/** Best-effort client address from proxy headers (first hop of X-Forwarded-For). */
export function clientInfo(headers: Headers | undefined): ClientInfo {
  const forwarded = headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: forwarded || headers?.get("x-real-ip") || null,
    userAgent: headers?.get("user-agent")?.slice(0, 300) ?? null,
  };
}

/** Writes an audit row. Throws on failure: use `recordAuditSafe` where auditing must not block. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  await getDb().auditLog.create({
    data: {
      action: entry.action,
      actorId: entry.actorId ?? null,
      actorEmail: entry.actorEmail ?? null,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      metadata: entry.metadata,
    },
  });
}

/** For authentication hooks: a failing audit write is logged loudly but never breaks sign-in. */
export async function recordAuditSafe(entry: AuditEntry): Promise<void> {
  try {
    await recordAudit(entry);
  } catch (error) {
    logger.error({ err: error, action: entry.action }, "failed to write audit log");
  }
}

export interface AuditRow {
  id: string;
  createdAt: Date;
  action: string;
  actorEmail: string | null;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
}

export async function listAudit(
  actor: Actor | null | undefined,
  options: { limit?: number; action?: string } = {},
): Promise<AuditRow[]> {
  assertCan(actor, "audit:read");
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  return getDb().auditLog.findMany({
    where: options.action ? { action: options.action } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      action: true,
      actorEmail: true,
      entityType: true,
      entityId: true,
      ip: true,
    },
  });
}
