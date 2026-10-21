import type { CrmContext } from "@/modules/crm/context";
import { can } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";
import { listDueMaintenance } from "./maintenance";
import { DEFAULT_RENEWAL_WARNING_DAYS, addDaysUtc, startOfDayUtc } from "./rules";

export interface CareStats {
  /** null when the user may not see that area. */
  tickets: { open: number; urgent: number } | null;
  maintenance: { overdue: number; dueSoon: number } | null;
  assets: { warrantyExpiring: number } | null;
}

/** Counts computed live from the data; nothing is hard-coded. Each area follows its own permission. */
export async function getCareStats(ctx: CrmContext, now = new Date()): Promise<CareStats> {
  const role = ctx.actor?.role;
  const db = getDb();
  const today = startOfDayUtc(now);

  const OPEN: ("open" | "in_progress" | "waiting_customer")[] = [
    "open",
    "in_progress",
    "waiting_customer",
  ];
  const tickets = can(role, "ticket:read")
    ? {
        open: await db.ticket.count({ where: { status: { in: OPEN } } }),
        urgent: await db.ticket.count({
          where: { status: { in: OPEN }, priority: { in: ["high", "urgent"] } },
        }),
      }
    : null;

  const maintenance = can(role, "maintenance:read")
    ? await (async () => {
        const due = await listDueMaintenance(ctx, now);
        return {
          overdue: due.filter((d) => d.state === "overdue").length,
          dueSoon: due.filter((d) => d.state === "due_soon").length,
        };
      })()
    : null;

  const assets = can(role, "asset:read")
    ? {
        warrantyExpiring: await db.asset.count({
          where: {
            status: { not: "retired" },
            warrantyUntil: {
              gte: today,
              lte: addDaysUtc(today, DEFAULT_RENEWAL_WARNING_DAYS),
            },
          },
        }),
      }
    : null;

  return { tickets, maintenance, assets };
}
