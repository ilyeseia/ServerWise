import { assertCan } from "@/server/authz/guard";
import { getDb } from "@/server/db/client";
import type { CrmContext } from "./context";
import { LEAD_STATUSES, type LeadStatus } from "./lead-status";

export interface CrmStats {
  customers: { prospect: number; active: number };
  leadsByStatus: Record<LeadStatus, number>;
  openFollowUps: number;
  overdueFollowUps: number;
  myOpenFollowUps: number;
  myOverdueFollowUps: number;
  newCustomersLast30Days: number;
}

/** Every figure is computed from the database; there are no demo numbers. */
export async function getCrmStats(ctx: CrmContext, now = new Date()): Promise<CrmStats> {
  assertCan(ctx.actor, "crm:read");
  const me = ctx.actor.id;
  const db = getDb();
  const since = new Date(now.getTime() - 30 * 24 * 3600_000);

  const [customerGroups, leadGroups, open, overdue, myOpen, myOverdue, recent] = await Promise.all([
    db.customer.groupBy({ by: ["status"], _count: { _all: true } }),
    db.lead.groupBy({ by: ["status"], _count: { _all: true } }),
    db.followUp.count({ where: { status: "open" } }),
    db.followUp.count({ where: { status: "open", dueAt: { lt: now } } }),
    db.followUp.count({ where: { status: "open", assignedToId: me } }),
    db.followUp.count({ where: { status: "open", assignedToId: me, dueAt: { lt: now } } }),
    db.customer.count({ where: { createdAt: { gte: since }, status: { not: "archived" } } }),
  ]);

  const customers = { prospect: 0, active: 0 };
  for (const g of customerGroups) {
    if (g.status === "prospect" || g.status === "active") customers[g.status] = g._count._all;
  }
  const leadsByStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<
    LeadStatus,
    number
  >;
  for (const g of leadGroups) leadsByStatus[g.status] = g._count._all;

  return {
    customers,
    leadsByStatus,
    openFollowUps: open,
    overdueFollowUps: overdue,
    myOpenFollowUps: myOpen,
    myOverdueFollowUps: myOverdue,
    newCustomersLast30Days: recent,
  };
}
