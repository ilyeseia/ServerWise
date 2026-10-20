import type { Prisma } from "@/generated/prisma/client";
import { auditData } from "@/server/audit/tx";
import { assertCan, RuleViolationError } from "@/server/authz/guard";
import { can } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";
import { notFound, orNull, type CrmContext, type Page } from "./context";
import { followUpInput, pageInput, type FollowUpInput } from "./schemas";

export interface FollowUpItem {
  id: string;
  title: string;
  dueAt: Date;
  status: "open" | "done" | "cancelled";
  overdue: boolean;
  customerId: string;
  customerName: string;
  leadId: string | null;
  leadTitle: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  notes: string | null;
}

/** An open follow-up is overdue once its due time has passed. */
export function isOverdue(followUp: { status: string; dueAt: Date }, now = new Date()): boolean {
  return followUp.status === "open" && followUp.dueAt.getTime() < now.getTime();
}

export interface FollowUpQuery {
  /** "mine": assigned to the caller. "all": everyone's. */
  scope?: "mine" | "all";
  status?: "open" | "done" | "cancelled";
  overdueOnly?: boolean;
  customerId?: string;
  leadId?: string;
  page?: number;
  pageSize?: number;
}

export async function listFollowUps(
  ctx: CrmContext,
  query: FollowUpQuery = {},
): Promise<Page<FollowUpItem>> {
  assertCan(ctx.actor, "crm:read");
  const actor = ctx.actor;
  const { page, pageSize } = pageInput.parse({ page: query.page, pageSize: query.pageSize });
  const now = new Date();

  const where: Prisma.FollowUpWhereInput = {
    status: query.overdueOnly ? "open" : (query.status ?? "open"),
    ...(query.scope === "mine" ? { assignedToId: actor.id } : {}),
    ...(query.overdueOnly ? { dueAt: { lt: now } } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.leadId ? { leadId: query.leadId } : {}),
  };

  const db = getDb();
  const [total, rows] = await Promise.all([
    db.followUp.count({ where }),
    db.followUp.findMany({
      where,
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        customer: { select: { name: true } },
        lead: { select: { title: true } },
        assignedTo: { select: { name: true } },
      },
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    items: rows.map((f) => ({
      id: f.id,
      title: f.title,
      dueAt: f.dueAt,
      status: f.status,
      overdue: isOverdue(f, now),
      customerId: f.customerId,
      customerName: f.customer.name,
      leadId: f.leadId,
      leadTitle: f.lead?.title ?? null,
      assignedToId: f.assignedToId,
      assignedToName: f.assignedTo?.name ?? null,
      notes: f.notes,
    })),
  };
}

export async function createFollowUp(ctx: CrmContext, input: FollowUpInput) {
  assertCan(ctx.actor, "crm:write");
  const actor = ctx.actor;
  const data = followUpInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: data.customerId } });
    if (!customer) throw notFound("Customer");
    if (customer.status === "archived") {
      throw new RuleViolationError("CUSTOMER_ARCHIVED", "Restore the customer first");
    }
    if (data.leadId) {
      const lead = await tx.lead.findUnique({ where: { id: data.leadId } });
      if (!lead) throw notFound("Lead");
      if (lead.customerId !== data.customerId) {
        throw new RuleViolationError(
          "LEAD_CUSTOMER_MISMATCH",
          "The lead belongs to another customer",
        );
      }
    }
    if (data.assignedToId) {
      const user = await tx.user.findUnique({
        where: { id: data.assignedToId },
        select: { role: true, banned: true },
      });
      if (!user || user.banned || !can(user.role, "crm:read")) {
        throw new RuleViolationError(
          "INVALID_ASSIGNEE",
          "The selected person cannot be assigned follow-ups",
        );
      }
    }

    const followUp = await tx.followUp.create({
      data: {
        customerId: data.customerId,
        leadId: orNull(data.leadId),
        title: data.title,
        dueAt: data.dueAt,
        assignedToId: data.assignedToId ?? actor.id,
        notes: orNull(data.notes),
        createdById: actor.id,
      },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "followup.created",
        "follow_up",
        followUp.id,
        { customerId: data.customerId },
        ctx.client,
      ),
    });
    return followUp;
  });
}

type Transition = "done" | "cancelled" | "open";

const ACTIONS = {
  done: "followup.completed",
  cancelled: "followup.cancelled",
  open: "followup.reopened",
} as const;

async function setStatus(ctx: CrmContext, id: string, to: Transition) {
  assertCan(ctx.actor, "crm:write");
  const actor = ctx.actor;
  const db = getDb();

  return db.$transaction(async (tx) => {
    const followUp = await tx.followUp.findUnique({ where: { id } });
    if (!followUp) throw notFound("Follow-up");
    // Done/cancelled are only reachable from open; open is only reachable from the others.
    const valid = to === "open" ? followUp.status !== "open" : followUp.status === "open";
    if (!valid) {
      throw new RuleViolationError(
        "INVALID_TRANSITION",
        `Cannot move a ${followUp.status} follow-up to ${to}`,
      );
    }
    const updated = await tx.followUp.update({
      where: { id },
      data: {
        status: to,
        completedAt: to === "done" ? new Date() : null,
        completedById: to === "done" ? actor.id : null,
      },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        ACTIONS[to],
        "follow_up",
        id,
        { customerId: followUp.customerId },
        ctx.client,
      ),
    });
    return updated;
  });
}

export const completeFollowUp = (ctx: CrmContext, id: string) => setStatus(ctx, id, "done");
export const cancelFollowUp = (ctx: CrmContext, id: string) => setStatus(ctx, id, "cancelled");
export const reopenFollowUp = (ctx: CrmContext, id: string) => setStatus(ctx, id, "open");
