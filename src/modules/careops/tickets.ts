import type { Prisma } from "@/generated/prisma/client";
import { notFound, orNull, type CrmContext, type Page } from "@/modules/crm/context";
import { pageInput } from "@/modules/crm/schemas";
import { auditData } from "@/server/audit/tx";
import { assertCan, RuleViolationError } from "@/server/authz/guard";
import { can } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  allowedNextTicketStatuses,
  canTransitionTicket,
  isTicketClosed,
  ticketBlockers,
  type TicketPriority,
  type TicketStatus,
} from "./rules";
import {
  commentInput,
  ticketInput,
  ticketStatusInput,
  ticketUpdateInput,
  type TicketInput,
  type TicketStatusInput,
  type TicketUpdateInput,
} from "./schemas";

type Tx = Prisma.TransactionClient;

async function nextTicketNumber(tx: Tx, now: Date): Promise<string> {
  const year = now.getUTCFullYear();
  const rows = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO "ticket_counter" ("year", "last") VALUES (${year}, 1)
    ON CONFLICT ("year") DO UPDATE SET "last" = "ticket_counter"."last" + 1
    RETURNING "last"`;
  return `T-${year}-${String(rows[0]!.last).padStart(4, "0")}`;
}

/** Only active staff who work on tickets can be assigned. */
async function assertAssignee(tx: Tx, userId: string | undefined) {
  if (!userId) return;
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { role: true, banned: true },
  });
  if (!user || user.banned || !can(user.role, "ticket:write")) {
    throw new RuleViolationError("INVALID_ASSIGNEE", "The selected person cannot be assigned");
  }
}

async function assertAssetOfCustomer(tx: Tx, assetId: string | undefined, customerId: string) {
  if (!assetId) return;
  const asset = await tx.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw notFound("Asset");
  if (asset.customerId !== customerId) {
    throw new RuleViolationError(
      "ASSET_CUSTOMER_MISMATCH",
      "The asset belongs to another customer",
    );
  }
}

export interface TicketListItem {
  id: string;
  number: string;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  customerId: string;
  customerName: string;
  assigneeName: string | null;
  createdAt: Date;
}

export interface TicketListQuery {
  status?: string;
  priority?: string;
  customerId?: string;
  assigneeId?: string;
  /** Only tickets that still need attention. */
  openOnly?: boolean;
  q?: string;
  page?: number;
  pageSize?: number;
}

export async function listTickets(
  ctx: CrmContext,
  query: TicketListQuery = {},
): Promise<Page<TicketListItem>> {
  assertCan(ctx.actor, "ticket:read");
  const { page, pageSize } = pageInput.parse({ page: query.page, pageSize: query.pageSize });
  const status = TICKET_STATUSES.find((s) => s === query.status);
  const priority = TICKET_PRIORITIES.find((p) => p === query.priority);
  const q = query.q?.trim();

  const where: Prisma.TicketWhereInput = {
    ...(status
      ? { status }
      : query.openOnly
        ? { status: { in: ["open", "in_progress", "waiting_customer"] } }
        : {}),
    ...(priority ? { priority } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { number: { contains: q, mode: "insensitive" } },
            { customer: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const db = getDb();
  const [total, rows] = await Promise.all([
    db.ticket.count({ where }),
    db.ticket.findMany({
      where,
      // Enum order is declaration order (low..urgent), so descending puts urgent first.
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        customer: { select: { name: true } },
        assignee: { select: { name: true } },
      },
    }),
  ]);
  return {
    total,
    page,
    pageSize,
    items: rows.map((t) => ({
      id: t.id,
      number: t.number,
      title: t.title,
      status: t.status,
      priority: t.priority,
      customerId: t.customerId,
      customerName: t.customer.name,
      assigneeName: t.assignee?.name ?? null,
      createdAt: t.createdAt,
    })),
  };
}

export async function getTicket(ctx: CrmContext, id: string) {
  assertCan(ctx.actor, "ticket:read");
  const ticket = await getDb().ticket.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true } },
      asset: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      comments: { orderBy: { createdAt: "asc" } },
      serviceReports: { orderBy: { performedAt: "desc" } },
    },
  });
  if (!ticket) throw notFound("Ticket");
  const authors = await getDb().user.findMany({
    where: { id: { in: ticket.comments.flatMap((c) => (c.authorId ? [c.authorId] : [])) } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(authors.map((a) => [a.id, a.name]));
  return {
    ...ticket,
    comments: ticket.comments.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      authorName: c.authorId ? (nameOf.get(c.authorId) ?? null) : null,
    })),
    nextStatuses: allowedNextTicketStatuses(ticket.status),
  };
}

/** Staff who can be given tickets. */
export async function listTicketStaff(ctx: CrmContext) {
  assertCan(ctx.actor, "ticket:read");
  const users = await getDb().user.findMany({
    where: { banned: { not: true } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });
  return users.filter((u) => can(u.role, "ticket:write")).map(({ id, name }) => ({ id, name }));
}

export async function createTicket(ctx: CrmContext, input: TicketInput, now = new Date()) {
  assertCan(ctx.actor, "ticket:write");
  const actor = ctx.actor;
  const data = ticketInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: data.customerId } });
    if (!customer) throw notFound("Customer");
    if (customer.status === "archived") {
      throw new RuleViolationError("CUSTOMER_ARCHIVED", "The customer is archived");
    }
    await assertAssetOfCustomer(tx, data.assetId, data.customerId);
    await assertAssignee(tx, data.assigneeId);
    const number = await nextTicketNumber(tx, now);
    const ticket = await tx.ticket.create({
      data: {
        number,
        customerId: data.customerId,
        assetId: orNull(data.assetId),
        title: data.title,
        description: orNull(data.description),
        priority: data.priority,
        assigneeId: orNull(data.assigneeId),
        createdById: actor.id,
      },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "ticket.created",
        "ticket",
        ticket.id,
        { number, customerId: data.customerId, priority: data.priority },
        ctx.client,
      ),
    });
    return { id: ticket.id, number };
  });
}

export async function updateTicket(ctx: CrmContext, id: string, input: TicketUpdateInput) {
  assertCan(ctx.actor, "ticket:write");
  const actor = ctx.actor;
  const data = ticketUpdateInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const ticket = await tx.ticket.findUnique({ where: { id } });
    if (!ticket) throw notFound("Ticket");
    if (isTicketClosed(ticket.status)) {
      throw new RuleViolationError("TICKET_CLOSED", "A closed ticket cannot change");
    }
    await assertAssetOfCustomer(tx, data.assetId, ticket.customerId);
    await assertAssignee(tx, data.assigneeId);
    await tx.ticket.update({
      where: { id },
      data: {
        title: data.title,
        description: orNull(data.description),
        priority: data.priority,
        assetId: orNull(data.assetId),
        assigneeId: orNull(data.assigneeId),
      },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "ticket.updated",
        "ticket",
        id,
        { priority: data.priority },
        ctx.client,
      ),
    });
    return { id };
  });
}

export async function changeTicketStatus(
  ctx: CrmContext,
  id: string,
  input: TicketStatusInput,
  now = new Date(),
) {
  assertCan(ctx.actor, "ticket:write");
  const actor = ctx.actor;
  const { to, resolution } = ticketStatusInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const ticket = await tx.ticket.findUnique({ where: { id } });
    if (!ticket) throw notFound("Ticket");
    if (!canTransitionTicket(ticket.status, to)) {
      throw new RuleViolationError(
        "INVALID_TRANSITION",
        `A ${ticket.status} ticket cannot become ${to}`,
      );
    }
    const written = resolution ?? ticket.resolution;
    const [blocker] = ticketBlockers(to, { resolution: written });
    if (blocker) throw new RuleViolationError(blocker, "A resolution is required");

    await tx.ticket.update({
      where: { id },
      data: {
        status: to,
        ...(resolution ? { resolution } : {}),
        // Reopening clears the resolution date; the text stays as history until rewritten.
        resolvedAt: to === "resolved" ? now : to === "closed" ? ticket.resolvedAt : null,
        closedAt: to === "closed" ? now : null,
      },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "ticket.status_changed",
        "ticket",
        id,
        { from: ticket.status, to },
        ctx.client,
      ),
    });
    return { status: to };
  });
}

export async function addComment(ctx: CrmContext, ticketId: string, body: string) {
  assertCan(ctx.actor, "ticket:write");
  const actor = ctx.actor;
  const text = commentInput.parse(body);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const ticket = await tx.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw notFound("Ticket");
    if (isTicketClosed(ticket.status)) {
      throw new RuleViolationError("TICKET_CLOSED", "A closed ticket cannot receive comments");
    }
    const comment = await tx.ticketComment.create({
      data: { ticketId, authorId: actor.id, body: text },
    });
    await tx.auditLog.create({
      data: auditData(actor, "ticket.commented", "ticket", ticketId, {}, ctx.client),
    });
    return { id: comment.id };
  });
}
