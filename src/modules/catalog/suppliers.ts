import { notFound, orNull, type CrmContext } from "@/modules/crm/context";
import { auditData } from "@/server/audit/tx";
import { assertCan, RuleViolationError } from "@/server/authz/guard";
import { getDb } from "@/server/db/client";
import { supplierInput, type SupplierInput } from "./schemas";

export interface SupplierListItem {
  id: string;
  name: string;
  kind: string;
  wilayaCode: number | null;
  phone: string | null;
  url: string | null;
  notes: string | null;
  active: boolean;
  observations: number;
}

export async function listSuppliers(
  ctx: CrmContext,
  options: { includeInactive?: boolean } = {},
): Promise<SupplierListItem[]> {
  assertCan(ctx.actor, "catalog:read");
  const rows = await getDb().supplier.findMany({
    where: options.includeInactive ? {} : { active: true },
    orderBy: { name: "asc" },
    include: { _count: { select: { offers: true } } },
  });
  return rows.map(({ _count, ...s }) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    wilayaCode: s.wilayaCode,
    phone: s.phone,
    url: s.url,
    notes: s.notes,
    active: s.active,
    observations: _count.offers,
  }));
}

function data(input: ReturnType<typeof supplierInput.parse>) {
  return {
    name: input.name,
    kind: input.kind,
    wilayaCode: orNull(input.wilayaCode),
    phone: orNull(input.phone),
    url: orNull(input.url),
    notes: orNull(input.notes),
  };
}

export async function createSupplier(ctx: CrmContext, input: SupplierInput) {
  assertCan(ctx.actor, "catalog:write");
  const actor = ctx.actor;
  const parsed = supplierInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const taken = await tx.supplier.findFirst({
      where: { name: { equals: parsed.name, mode: "insensitive" } },
      select: { id: true },
    });
    if (taken)
      throw new RuleViolationError("SUPPLIER_EXISTS", "A supplier with this name already exists");
    const supplier = await tx.supplier.create({ data: data(parsed) });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "supplier.created",
        "supplier",
        supplier.id,
        { kind: parsed.kind },
        ctx.client,
      ),
    });
    return supplier;
  });
}

export async function updateSupplier(ctx: CrmContext, id: string, input: SupplierInput) {
  assertCan(ctx.actor, "catalog:write");
  const actor = ctx.actor;
  const parsed = supplierInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const before = await tx.supplier.findUnique({ where: { id } });
    if (!before) throw notFound("Supplier");
    const clash = await tx.supplier.findFirst({
      where: { name: { equals: parsed.name, mode: "insensitive" }, id: { not: id } },
      select: { id: true },
    });
    if (clash)
      throw new RuleViolationError("SUPPLIER_EXISTS", "A supplier with this name already exists");
    const next = data(parsed);
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
      (k) => next[k] !== before[k],
    );
    const supplier = await tx.supplier.update({ where: { id }, data: next });
    await tx.auditLog.create({
      data: auditData(actor, "supplier.updated", "supplier", id, { changed }, ctx.client),
    });
    return supplier;
  });
}

/** An inactive supplier takes no new price observations; existing ones stay as history. */
export async function setSupplierActive(ctx: CrmContext, id: string, active: boolean) {
  assertCan(ctx.actor, "catalog:write");
  const actor = ctx.actor;
  const db = getDb();

  await db.$transaction(async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id } });
    if (!supplier) throw notFound("Supplier");
    if (supplier.active === active) return;
    await tx.supplier.update({ where: { id }, data: { active } });
    await tx.auditLog.create({
      data: auditData(
        actor,
        active ? "supplier.reactivated" : "supplier.deactivated",
        "supplier",
        id,
        undefined,
        ctx.client,
      ),
    });
  });
}
