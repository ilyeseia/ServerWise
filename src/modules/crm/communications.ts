import { auditData } from "@/server/audit/tx";
import { assertCan, RuleViolationError } from "@/server/authz/guard";
import { getDb } from "@/server/db/client";
import { notFound, orNull, type CrmContext } from "./context";
import { communicationInput, type CommunicationInput } from "./schemas";

/** Allow a few minutes of clock difference between the browser and the server. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

export interface CommunicationItem {
  id: string;
  channel: string;
  direction: "inbound" | "outbound";
  occurredAt: Date;
  summary: string;
  leadId: string | null;
  leadTitle: string | null;
  authorName: string | null;
}

export async function logCommunication(ctx: CrmContext, input: CommunicationInput) {
  assertCan(ctx.actor, "crm:write");
  const actor = ctx.actor;
  const data = communicationInput.parse(input);

  if (data.occurredAt.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
    throw new RuleViolationError("FUTURE_DATE", "A conversation cannot be dated in the future");
  }
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
    const entry = await tx.communication.create({
      data: {
        customerId: data.customerId,
        leadId: orNull(data.leadId),
        channel: data.channel,
        direction: data.direction,
        occurredAt: data.occurredAt,
        summary: data.summary,
        createdById: actor.id,
      },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "communication.logged",
        "communication",
        entry.id,
        { customerId: data.customerId },
        ctx.client,
      ),
    });
    return entry;
  });
}

/** Newest first. The log is append-only: there is no edit or delete. */
export async function listCommunications(
  ctx: CrmContext,
  filter: { customerId?: string; leadId?: string },
  limit = 50,
): Promise<CommunicationItem[]> {
  assertCan(ctx.actor, "crm:read");
  const rows = await getDb().communication.findMany({
    where: {
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
      ...(filter.leadId ? { leadId: filter.leadId } : {}),
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(limit, 1), 200),
    include: { lead: { select: { title: true } } },
  });

  const authorIds = [...new Set(rows.map((r) => r.createdById).filter((v): v is string => !!v))];
  const authors = authorIds.length
    ? await getDb().user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, name: true },
      })
    : [];
  const names = new Map(authors.map((a) => [a.id, a.name]));

  return rows.map((r) => ({
    id: r.id,
    channel: r.channel,
    direction: r.direction,
    occurredAt: r.occurredAt,
    summary: r.summary,
    leadId: r.leadId,
    leadTitle: r.lead?.title ?? null,
    authorName: r.createdById ? (names.get(r.createdById) ?? null) : null,
  }));
}
