import type { CrmContext } from "@/modules/crm/context";
import type { Actor } from "@/server/authz/guard";
import type { Role } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";
import { createTestUser, type TestUser } from "./helpers";

export interface TestStaff {
  user: TestUser;
  actor: Actor;
  ctx: CrmContext;
}

export async function createStaff(role: Role): Promise<TestStaff> {
  const user = await createTestUser(role);
  const actor: Actor = { id: user.id, email: user.email, name: `Test ${role}`, role };
  return { user, actor, ctx: { actor, client: { ip: "203.0.113.5", userAgent: "vitest" } } };
}

/** Unique, recognisable test data: the audit log is append-only, so rows are tagged. */
export const unique = (label: string) => `ZZ ${label} ${crypto.randomUUID().slice(0, 8)}`;

export function randomPhone(): string {
  return `05${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
}

export async function auditCount(action: string, entityId: string): Promise<number> {
  return getDb().auditLog.count({ where: { action, entityId } });
}

/**
 * Removes test customers and everything under them. The communication log is append-only, so
 * its trigger is disabled inside the same transaction (DDL is transactional in PostgreSQL: if
 * anything fails, the trigger is back on).
 */
export async function deleteCustomers(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `ALTER TABLE "communication" DISABLE TRIGGER communication_no_update_delete`,
    );
    await tx.communication.deleteMany({ where: { customerId: { in: ids } } });
    await tx.$executeRawUnsafe(
      `ALTER TABLE "communication" ENABLE TRIGGER communication_no_update_delete`,
    );
    // Saved recommendations are immutable snapshots; same trick as above.
    await tx.$executeRawUnsafe(
      `ALTER TABLE "recommendation" DISABLE TRIGGER recommendation_no_update_delete`,
    );
    await tx.recommendation.deleteMany({ where: { lead: { customerId: { in: ids } } } });
    await tx.$executeRawUnsafe(
      `ALTER TABLE "recommendation" ENABLE TRIGGER recommendation_no_update_delete`,
    );
    await tx.followUp.deleteMany({ where: { customerId: { in: ids } } });
    await tx.lead.deleteMany({ where: { customerId: { in: ids } } });
    await tx.customer.deleteMany({ where: { id: { in: ids } } });
  });
}

/**
 * Removes test products and suppliers with their price history. Observations are immutable
 * (trigger), so the delete guard is lifted inside the transaction only.
 */
export async function deleteCatalog(productIds: string[], supplierIds: string[]): Promise<void> {
  if (productIds.length === 0 && supplierIds.length === 0) return;
  const db = getDb();
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `ALTER TABLE "supplier_offer" DISABLE TRIGGER supplier_offer_guard_delete`,
    );
    await tx.supplierOffer.deleteMany({
      where: { OR: [{ productId: { in: productIds } }, { supplierId: { in: supplierIds } }] },
    });
    await tx.$executeRawUnsafe(
      `ALTER TABLE "supplier_offer" ENABLE TRIGGER supplier_offer_guard_delete`,
    );
    await tx.product.deleteMany({ where: { id: { in: productIds } } });
    await tx.supplier.deleteMany({ where: { id: { in: supplierIds } } });
  });
}
