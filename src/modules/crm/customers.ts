import type { Prisma } from "@/generated/prisma/client";
import { auditData } from "@/server/audit/tx";
import { assertCan, RuleViolationError } from "@/server/authz/guard";
import { getDb } from "@/server/db/client";
import { notFound, orNull, type CrmContext, type Page } from "./context";
import {
  contactInput,
  customerInput,
  pageInput,
  type ContactInput,
  type CustomerInput,
} from "./schemas";

export interface CustomerListItem {
  id: string;
  type: "individual" | "business";
  name: string;
  phone: string | null;
  email: string | null;
  wilayaCode: number | null;
  status: "prospect" | "active" | "archived";
  openLeads: number;
  createdAt: Date;
}

export interface CustomerListQuery {
  q?: string;
  type?: "individual" | "business";
  status?: "prospect" | "active" | "archived";
  page?: number;
  pageSize?: number;
}

/** Archived customers are hidden unless explicitly requested with status=archived. */
export async function listCustomers(
  ctx: CrmContext,
  query: CustomerListQuery = {},
): Promise<Page<CustomerListItem>> {
  assertCan(ctx.actor, "crm:read");
  const { page, pageSize } = pageInput.parse({ page: query.page, pageSize: query.pageSize });
  const q = query.q?.trim();

  const where: Prisma.CustomerWhereInput = {
    ...(query.status ? { status: query.status } : { status: { not: "archived" } }),
    ...(query.type ? { type: query.type } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { legalName: { contains: q, mode: "insensitive" } },
            { phone: { contains: q.replace(/\s+/g, "") } },
            { phone: { contains: q } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const db = getDb();
  const [total, rows] = await Promise.all([
    db.customer.count({ where }),
    db.customer.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        type: true,
        name: true,
        phone: true,
        email: true,
        wilayaCode: true,
        status: true,
        createdAt: true,
        _count: { select: { leads: { where: { status: { notIn: ["won", "lost"] } } } } },
      },
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    items: rows.map(({ _count, ...c }) => ({ ...c, openLeads: _count.leads })),
  };
}

export async function getCustomer(ctx: CrmContext, id: string) {
  assertCan(ctx.actor, "crm:read");
  const customer = await getDb().customer.findUnique({
    where: { id },
    include: {
      contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      leads: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!customer) throw notFound("Customer");
  return customer;
}

export async function createCustomer(ctx: CrmContext, input: CustomerInput) {
  assertCan(ctx.actor, "crm:write");
  const actor = ctx.actor;
  const data = customerInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const customer = await tx.customer.create({
      data: {
        type: data.type,
        name: data.name,
        legalName: orNull(data.legalName),
        taxId: orNull(data.taxId),
        phone: orNull(data.phone),
        email: orNull(data.email),
        wilayaCode: orNull(data.wilayaCode),
        address: orNull(data.address),
        preferredLanguage: data.preferredLanguage,
        notes: orNull(data.notes),
        createdById: actor.id,
      },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "customer.created",
        "customer",
        customer.id,
        { type: data.type },
        ctx.client,
      ),
    });
    return customer;
  });
}

export async function updateCustomer(ctx: CrmContext, id: string, input: CustomerInput) {
  assertCan(ctx.actor, "crm:write");
  const actor = ctx.actor;
  const data = customerInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const before = await tx.customer.findUnique({ where: { id } });
    if (!before) throw notFound("Customer");
    if (before.status === "archived") {
      throw new RuleViolationError("CUSTOMER_ARCHIVED", "Restore the customer before editing");
    }

    const next = {
      type: data.type,
      name: data.name,
      legalName: orNull(data.legalName),
      taxId: orNull(data.taxId),
      phone: orNull(data.phone),
      email: orNull(data.email),
      wilayaCode: orNull(data.wilayaCode),
      address: orNull(data.address),
      preferredLanguage: data.preferredLanguage,
      notes: orNull(data.notes),
    };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
      (k) => next[k] !== before[k],
    );

    const customer = await tx.customer.update({ where: { id }, data: next });
    await tx.auditLog.create({
      data: auditData(actor, "customer.updated", "customer", id, { changed }, ctx.client),
    });
    return customer;
  });
}

/** Archiving hides a customer but keeps all history. Blocked while a lead is still open. */
export async function archiveCustomer(ctx: CrmContext, id: string) {
  assertCan(ctx.actor, "crm:archive");
  const actor = ctx.actor;
  const db = getDb();

  await db.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id } });
    if (!customer) throw notFound("Customer");
    if (customer.status === "archived") return;

    const openLeads = await tx.lead.count({
      where: { customerId: id, status: { notIn: ["won", "lost"] } },
    });
    if (openLeads > 0) {
      throw new RuleViolationError("HAS_OPEN_LEADS", "Close the customer's open leads first");
    }
    await tx.customer.update({
      where: { id },
      data: { status: "archived", archivedAt: new Date() },
    });
    await tx.auditLog.create({
      data: auditData(actor, "customer.archived", "customer", id, undefined, ctx.client),
    });
  });
}

/** Restores to "active" if the customer ever won work, otherwise back to "prospect". */
export async function restoreCustomer(ctx: CrmContext, id: string) {
  assertCan(ctx.actor, "crm:archive");
  const actor = ctx.actor;
  const db = getDb();

  await db.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id } });
    if (!customer) throw notFound("Customer");
    if (customer.status !== "archived") return;

    const won = await tx.lead.count({ where: { customerId: id, status: "won" } });
    await tx.customer.update({
      where: { id },
      data: { status: won > 0 ? "active" : "prospect", archivedAt: null },
    });
    await tx.auditLog.create({
      data: auditData(actor, "customer.restored", "customer", id, undefined, ctx.client),
    });
  });
}

// --- Contacts ---------------------------------------------------------------------------------

export async function addContact(ctx: CrmContext, customerId: string, input: ContactInput) {
  assertCan(ctx.actor, "crm:write");
  const actor = ctx.actor;
  const data = contactInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw notFound("Customer");
    if (customer.status === "archived") {
      throw new RuleViolationError("CUSTOMER_ARCHIVED", "Restore the customer before editing");
    }
    // The first contact of a customer becomes primary automatically.
    const existing = await tx.contact.count({ where: { customerId } });
    const isPrimary = data.isPrimary || existing === 0;
    if (isPrimary)
      await tx.contact.updateMany({ where: { customerId }, data: { isPrimary: false } });

    const contact = await tx.contact.create({
      data: {
        customerId,
        name: data.name,
        jobTitle: orNull(data.jobTitle),
        phone: orNull(data.phone),
        email: orNull(data.email),
        isPrimary,
      },
    });
    await tx.auditLog.create({
      data: auditData(actor, "contact.created", "contact", contact.id, { customerId }, ctx.client),
    });
    return contact;
  });
}

export async function updateContact(ctx: CrmContext, contactId: string, input: ContactInput) {
  assertCan(ctx.actor, "crm:write");
  const actor = ctx.actor;
  const data = contactInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const before = await tx.contact.findUnique({ where: { id: contactId } });
    if (!before) throw notFound("Contact");
    if (data.isPrimary) {
      await tx.contact.updateMany({
        where: { customerId: before.customerId, id: { not: contactId } },
        data: { isPrimary: false },
      });
    }
    const contact = await tx.contact.update({
      where: { id: contactId },
      data: {
        name: data.name,
        jobTitle: orNull(data.jobTitle),
        phone: orNull(data.phone),
        email: orNull(data.email),
        // A customer's only/primary contact cannot be demoted without choosing another one.
        isPrimary: data.isPrimary || before.isPrimary,
      },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "contact.updated",
        "contact",
        contactId,
        { customerId: before.customerId },
        ctx.client,
      ),
    });
    return contact;
  });
}

export async function setPrimaryContact(ctx: CrmContext, contactId: string) {
  assertCan(ctx.actor, "crm:write");
  const actor = ctx.actor;
  const db = getDb();

  await db.$transaction(async (tx) => {
    const contact = await tx.contact.findUnique({ where: { id: contactId } });
    if (!contact) throw notFound("Contact");
    await tx.contact.updateMany({
      where: { customerId: contact.customerId },
      data: { isPrimary: false },
    });
    await tx.contact.update({ where: { id: contactId }, data: { isPrimary: true } });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "contact.updated",
        "contact",
        contactId,
        { customerId: contact.customerId, primary: true },
        ctx.client,
      ),
    });
  });
}

export async function deleteContact(ctx: CrmContext, contactId: string) {
  assertCan(ctx.actor, "crm:write");
  const actor = ctx.actor;
  const db = getDb();

  await db.$transaction(async (tx) => {
    const contact = await tx.contact.findUnique({ where: { id: contactId } });
    if (!contact) throw notFound("Contact");
    await tx.contact.delete({ where: { id: contactId } });
    // Keep the "one primary contact" convention: promote the oldest remaining contact.
    if (contact.isPrimary) {
      const next = await tx.contact.findFirst({
        where: { customerId: contact.customerId },
        orderBy: { createdAt: "asc" },
      });
      if (next) await tx.contact.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    await tx.auditLog.create({
      data: auditData(
        actor,
        "contact.deleted",
        "contact",
        contactId,
        { customerId: contact.customerId },
        ctx.client,
      ),
    });
  });
}
