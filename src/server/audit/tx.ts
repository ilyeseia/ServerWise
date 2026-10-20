import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/server/authz/guard";
import type { AuditAction, ClientInfo } from "./index";

/**
 * Builds the row for `tx.auditLog.create({ data })` so a business change and its audit trail
 * commit (or roll back) together:
 *
 *   await db.$transaction(async (tx) => {
 *     const row = await tx.customer.create(...);
 *     await tx.auditLog.create({ data: auditData(actor, "customer.created", "customer", row.id) });
 *   });
 */
export function auditData(
  actor: Actor,
  action: AuditAction,
  entityType: string,
  entityId: string,
  metadata?: Prisma.InputJsonValue,
  client?: Partial<ClientInfo>,
): Prisma.AuditLogCreateInput {
  return {
    action,
    actorId: actor.id,
    actorEmail: actor.email,
    entityType,
    entityId,
    ip: client?.ip ?? null,
    userAgent: client?.userAgent ?? null,
    metadata,
  };
}
