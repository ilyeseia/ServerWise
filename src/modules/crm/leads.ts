import { Prisma } from "@/generated/prisma/client";
import { auditData } from "@/server/audit/tx";
import { assertCan, RuleViolationError } from "@/server/authz/guard";
import { can } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";
import { notFound, orNull, type CrmContext, type Page } from "./context";
import { canTransition, isClosed, transitionEffect, type LeadStatus } from "./lead-status";
import {
  leadInput,
  leadUpdateInput,
  pageInput,
  type LeadInput,
  type LeadUpdateInput,
} from "./schemas";

const money = (v: number | undefined) => (v === undefined ? null : new Prisma.Decimal(v));

export interface LeadListItem {
  id: string;
  title: string;
  status: LeadStatus;
  source: string;
  customerId: string;
  customerName: string;
  ownerName: string | null;
  budgetMinDzd: string | null;
  budgetMaxDzd: string | null;
  createdAt: Date;
}

export interface LeadListQuery {
  q?: string;
  status?: LeadStatus;
  ownerId?: string;
  customerId?: string;
  page?: number;
  pageSize?: number;
}

export async function listLeads(
  ctx: CrmContext,
  query: LeadListQuery = {},
): Promise<Page<LeadListItem>> {
  assertCan(ctx.actor, "crm:read");
  const { page, pageSize } = pageInput.parse({ page: query.page, pageSize: query.pageSize });
  const q = query.q?.trim();

  const where: Prisma.LeadWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.ownerId ? { ownerId: query.ownerId } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { customer: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const db = getDb();
  const [total, rows] = await Promise.all([
    db.lead.count({ where }),
    db.lead.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { customer: { select: { name: true } }, owner: { select: { name: true } } },
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    items: rows.map((l) => ({
      id: l.id,
      title: l.title,
      status: l.status,
      source: l.source,
      customerId: l.customerId,
      customerName: l.customer.name,
      ownerName: l.owner?.name ?? null,
      budgetMinDzd: l.budgetMinDzd?.toString() ?? null,
      budgetMaxDzd: l.budgetMaxDzd?.toString() ?? null,
      createdAt: l.createdAt,
    })),
  };
}

export async function getLead(ctx: CrmContext, id: string) {
  assertCan(ctx.actor, "crm:read");
  const lead = await getDb().lead.findUnique({
    where: { id },
    include: {
      customer: true,
      owner: { select: { id: true, name: true } },
      requirements: true,
    },
  });
  if (!lead) throw notFound("Lead");
  return lead;
}

/** Staff who can own leads: active users allowed to write CRM data. */
export async function listAssignableUsers(ctx: CrmContext) {
  assertCan(ctx.actor, "crm:read");
  const users = await getDb().user.findMany({
    where: { banned: { not: true } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });
  return users.filter((u) => can(u.role, "crm:write")).map(({ id, name }) => ({ id, name }));
}

async function assertAssignable(
  ownerId: string | undefined,
  db: ReturnType<typeof getDb> | Prisma.TransactionClient,
) {
  if (!ownerId) return;
  const user = await db.user.findUnique({
    where: { id: ownerId },
    select: { role: true, banned: true },
  });
  if (!user || user.banned || !can(user.role, "crm:write")) {
    throw new RuleViolationError("INVALID_OWNER", "The selected owner cannot be assigned leads");
  }
}

export async function createLead(ctx: CrmContext, input: LeadInput) {
  assertCan(ctx.actor, "crm:write");
  const actor = ctx.actor;
  const data = leadInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: data.customerId } });
    if (!customer) throw notFound("Customer");
    if (customer.status === "archived") {
      throw new RuleViolationError("CUSTOMER_ARCHIVED", "Restore the customer before adding leads");
    }
    await assertAssignable(data.ownerId, tx);

    const lead = await tx.lead.create({
      data: {
        customerId: data.customerId,
        title: data.title,
        source: data.source,
        budgetMinDzd: money(data.budgetMinDzd),
        budgetMaxDzd: money(data.budgetMaxDzd),
        ownerId: data.ownerId ?? actor.id,
        notes: orNull(data.notes),
        createdById: actor.id,
      },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "lead.created",
        "lead",
        lead.id,
        { customerId: data.customerId },
        ctx.client,
      ),
    });
    return lead;
  });
}

export async function updateLead(ctx: CrmContext, id: string, input: LeadUpdateInput) {
  assertCan(ctx.actor, "crm:write");
  const actor = ctx.actor;
  const data = leadUpdateInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const before = await tx.lead.findUnique({ where: { id } });
    if (!before) throw notFound("Lead");
    if (isClosed(before.status)) {
      throw new RuleViolationError(
        "LEAD_CLOSED",
        "A closed lead cannot be edited; reopen it first",
      );
    }
    await assertAssignable(data.ownerId, tx);

    const lead = await tx.lead.update({
      where: { id },
      data: {
        title: data.title,
        source: data.source,
        budgetMinDzd: money(data.budgetMinDzd),
        budgetMaxDzd: money(data.budgetMaxDzd),
        ownerId: orNull(data.ownerId),
        notes: orNull(data.notes),
      },
    });
    await tx.auditLog.create({
      data: auditData(actor, "lead.updated", "lead", id, undefined, ctx.client),
    });
    return lead;
  });
}

/**
 * Moves a lead through the pipeline. Enforces the state machine, requires a reason to lose a
 * lead, stamps/clears `closedAt`, and activates the customer when a lead is won.
 */
export async function changeLeadStatus(
  ctx: CrmContext,
  id: string,
  to: LeadStatus,
  options: { lostReason?: string } = {},
) {
  assertCan(ctx.actor, "crm:write");
  const actor = ctx.actor;
  const db = getDb();

  return db.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id } });
    if (!lead) throw notFound("Lead");
    if (!canTransition(lead.status, to)) {
      throw new RuleViolationError(
        "INVALID_TRANSITION",
        `Cannot move a lead from ${lead.status} to ${to}`,
      );
    }

    const effect = transitionEffect(to);
    const lostReason = options.lostReason?.trim();
    if (effect.requiresLostReason && !lostReason) {
      throw new RuleViolationError(
        "LOST_REASON_REQUIRED",
        "A reason is required to mark a lead as lost",
      );
    }

    const updated = await tx.lead.update({
      where: { id },
      data: {
        status: to,
        closedAt: effect.closedAt === "now" ? new Date() : null,
        lostReason: effect.requiresLostReason ? lostReason!.slice(0, 300) : null,
      },
    });
    if (effect.customerStatus) {
      await tx.customer.updateMany({
        where: { id: lead.customerId, status: "prospect" },
        data: { status: effect.customerStatus },
      });
    }
    await tx.auditLog.create({
      data: auditData(
        actor,
        "lead.status_changed",
        "lead",
        id,
        { from: lead.status, to },
        ctx.client,
      ),
    });
    return updated;
  });
}
