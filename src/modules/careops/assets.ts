import type { Prisma } from "@/generated/prisma/client";
import { notFound, orNull, type CrmContext, type Page } from "@/modules/crm/context";
import { pageInput } from "@/modules/crm/schemas";
import { auditData } from "@/server/audit/tx";
import { assertCan, RuleViolationError } from "@/server/authz/guard";
import { getDb } from "@/server/db/client";
import { renewalState, type RenewalState } from "./rules";
import { assetInput, ASSET_KINDS, ASSET_STATUSES, type AssetInput } from "./schemas";

type Tx = Prisma.TransactionClient;

export interface AssetListItem {
  id: string;
  customerId: string;
  customerName: string;
  kind: (typeof ASSET_KINDS)[number];
  name: string;
  brandModel: string | null;
  serialNumber: string | null;
  status: (typeof ASSET_STATUSES)[number];
  warrantyUntil: Date | null;
  renewsAt: Date | null;
  warranty: RenewalState;
  renewal: RenewalState;
}

export interface AssetListQuery {
  q?: string;
  customerId?: string;
  kind?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export async function listAssets(
  ctx: CrmContext,
  query: AssetListQuery = {},
  now = new Date(),
): Promise<Page<AssetListItem>> {
  assertCan(ctx.actor, "asset:read");
  const { page, pageSize } = pageInput.parse({ page: query.page, pageSize: query.pageSize });
  const q = query.q?.trim();
  const kind = ASSET_KINDS.find((k) => k === query.kind);
  const status = ASSET_STATUSES.find((s) => s === query.status);

  const where: Prisma.AssetWhereInput = {
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(kind ? { kind } : {}),
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { serialNumber: { contains: q, mode: "insensitive" } },
            { brand: { contains: q, mode: "insensitive" } },
            { model: { contains: q, mode: "insensitive" } },
            { customer: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const db = getDb();
  const [total, rows] = await Promise.all([
    db.asset.count({ where }),
    db.asset.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { customer: { select: { name: true } } },
    }),
  ]);
  return {
    total,
    page,
    pageSize,
    items: rows.map((asset) => ({
      id: asset.id,
      customerId: asset.customerId,
      customerName: asset.customer.name,
      kind: asset.kind,
      name: asset.name,
      brandModel: [asset.brand, asset.model].filter(Boolean).join(" ") || null,
      serialNumber: asset.serialNumber,
      status: asset.status,
      warrantyUntil: asset.warrantyUntil,
      renewsAt: asset.renewsAt,
      warranty: renewalState(asset.warrantyUntil, now),
      renewal: renewalState(asset.renewsAt, now),
    })),
  };
}

export async function getAsset(ctx: CrmContext, id: string, now = new Date()) {
  assertCan(ctx.actor, "asset:read");
  const asset = await getDb().asset.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true } },
      project: { select: { id: true, number: true } },
      product: { select: { id: true, brand: true, model: true } },
      contracts: { include: { contract: { select: { id: true, title: true, endsAt: true } } } },
      tickets: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, number: true, title: true, status: true, priority: true },
      },
    },
  });
  if (!asset) throw notFound("Asset");
  return {
    ...asset,
    warranty: renewalState(asset.warrantyUntil, now),
    renewal: renewalState(asset.renewsAt, now),
  };
}

/** The references of an asset must exist and belong to the same customer. */
async function checkReferences(tx: Tx, data: ReturnType<typeof assetInput.parse>) {
  const customer = await tx.customer.findUnique({ where: { id: data.customerId } });
  if (!customer) throw notFound("Customer");
  if (customer.status === "archived") {
    throw new RuleViolationError("CUSTOMER_ARCHIVED", "The customer is archived");
  }
  if (data.projectId) {
    const project = await tx.project.findUnique({
      where: { id: data.projectId },
      include: { lead: { select: { customerId: true } } },
    });
    if (!project) throw notFound("Project");
    if (project.lead.customerId !== data.customerId) {
      throw new RuleViolationError(
        "PROJECT_CUSTOMER_MISMATCH",
        "The project belongs to another customer",
      );
    }
  }
  if (data.productId && !(await tx.product.findUnique({ where: { id: data.productId } }))) {
    throw notFound("Product");
  }
}

async function assertSerialFree(
  tx: Tx,
  customerId: string,
  serial: string | undefined,
  selfId?: string,
) {
  if (!serial) return;
  const other = await tx.asset.findFirst({
    where: { customerId, serialNumber: serial, ...(selfId ? { id: { not: selfId } } : {}) },
    select: { id: true },
  });
  if (other)
    throw new RuleViolationError("SERIAL_EXISTS", "This serial number is already recorded");
}

const toData = (data: ReturnType<typeof assetInput.parse>) => ({
  projectId: orNull(data.projectId),
  productId: orNull(data.productId),
  kind: data.kind,
  name: data.name,
  brand: orNull(data.brand),
  model: orNull(data.model),
  serialNumber: orNull(data.serialNumber),
  os: orNull(data.os),
  version: orNull(data.version),
  location: orNull(data.location),
  installedAt: orNull(data.installedAt),
  warrantyUntil: orNull(data.warrantyUntil),
  renewsAt: orNull(data.renewsAt),
  status: data.status,
  credentialsRef: orNull(data.credentialsRef),
  notes: orNull(data.notes),
});

export async function createAsset(ctx: CrmContext, input: AssetInput) {
  assertCan(ctx.actor, "asset:write");
  const actor = ctx.actor;
  const data = assetInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    await checkReferences(tx, data);
    await assertSerialFree(tx, data.customerId, data.serialNumber);
    const asset = await tx.asset.create({
      data: { customerId: data.customerId, createdById: actor.id, ...toData(data) },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "asset.created",
        "asset",
        asset.id,
        { customerId: data.customerId },
        ctx.client,
      ),
    });
    return { id: asset.id };
  });
}

/** The customer of an asset never changes; everything else can be corrected. */
export async function updateAsset(ctx: CrmContext, id: string, input: AssetInput) {
  assertCan(ctx.actor, "asset:write");
  const actor = ctx.actor;
  const data = assetInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const existing = await tx.asset.findUnique({ where: { id } });
    if (!existing) throw notFound("Asset");
    if (existing.customerId !== data.customerId) {
      throw new RuleViolationError("ASSET_CUSTOMER_FIXED", "An asset cannot change customer");
    }
    await checkReferences(tx, data);
    await assertSerialFree(tx, data.customerId, data.serialNumber, id);
    await tx.asset.update({ where: { id }, data: toData(data) });
    await tx.auditLog.create({
      data: auditData(actor, "asset.updated", "asset", id, { status: data.status }, ctx.client),
    });
    return { id };
  });
}
