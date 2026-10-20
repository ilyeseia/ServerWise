import { Prisma } from "@/generated/prisma/client";
import { notFound, orNull, type CrmContext, type Page } from "@/modules/crm/context";
import { pageInput } from "@/modules/crm/schemas";
import { auditData } from "@/server/audit/tx";
import { assertCan } from "@/server/authz/guard";
import { getDb } from "@/server/db/client";
import {
  DEFAULT_FRESHNESS,
  isUsable,
  offerState,
  STRICT_USAGE,
  type FreshnessPolicy,
  type OfferState,
} from "./freshness";
import { productInput, type ProductInput } from "./schemas";

const decimal = (v: number | undefined) => (v === undefined ? null : new Prisma.Decimal(v));

export interface PriceSummary {
  priceDzd: number;
  supplierName: string;
  condition: "new" | "refurbished" | "used";
  checkedAt: Date;
  state: OfferState;
}

export interface ProductListItem {
  id: string;
  category: string;
  brand: string;
  model: string;
  cpuModel: string | null;
  ramGb: number | null;
  storageMaxTb: string | null;
  active: boolean;
  /** Cheapest price that is verified and fresh today, or null. Never an unverified price. */
  bestPrice: PriceSummary | null;
  /** How many price observations exist at all (the history). */
  observations: number;
}

export interface ProductListQuery {
  q?: string;
  category?: string;
  includeInactive?: boolean;
  page?: number;
  pageSize?: number;
}

type OfferRow = {
  id: string;
  supplierId: string;
  priceDzd: Prisma.Decimal;
  condition: "new" | "refurbished" | "used";
  checkedAt: Date;
  verificationStatus: "unverified" | "verified" | "rejected";
  supplier: { name: string };
};

/**
 * The price to show for a product: for each supplier the newest observation that is usable
 * (strict rules: verified and fresh), then the cheapest of those.
 */
export function pickBestOffer<T extends OfferRow>(
  offers: T[],
  now = new Date(),
  policy: FreshnessPolicy = DEFAULT_FRESHNESS,
): T | null {
  const newestPerSupplier = new Map<string, T>();
  for (const o of offers) {
    if (!isUsable(offerState(o, now, policy), STRICT_USAGE)) continue;
    const current = newestPerSupplier.get(o.supplierId);
    if (!current || o.checkedAt > current.checkedAt) newestPerSupplier.set(o.supplierId, o);
  }
  return (
    [...newestPerSupplier.values()].sort(
      (a, b) =>
        Number(a.priceDzd) - Number(b.priceDzd) || b.checkedAt.getTime() - a.checkedAt.getTime(),
    )[0] ?? null
  );
}

export function pickBestPrice(
  offers: OfferRow[],
  now = new Date(),
  policy: FreshnessPolicy = DEFAULT_FRESHNESS,
): PriceSummary | null {
  const best = pickBestOffer(offers, now, policy);
  return best
    ? {
        priceDzd: Number(best.priceDzd.toString()),
        supplierName: best.supplier.name,
        condition: best.condition,
        checkedAt: best.checkedAt,
        state: offerState(best, now, policy),
      }
    : null;
}

export async function listProducts(
  ctx: CrmContext,
  query: ProductListQuery = {},
  now = new Date(),
): Promise<Page<ProductListItem>> {
  assertCan(ctx.actor, "catalog:read");
  const { page, pageSize } = pageInput.parse({ page: query.page, pageSize: query.pageSize });
  const q = query.q?.trim();

  const where: Prisma.ProductWhereInput = {
    ...(query.includeInactive ? {} : { active: true }),
    ...(query.category ? { category: query.category as never } : {}),
    ...(q
      ? {
          OR: [
            { brand: { contains: q, mode: "insensitive" } },
            { model: { contains: q, mode: "insensitive" } },
            { cpuModel: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const db = getDb();
  const [total, rows] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({
      where,
      orderBy: [{ brand: "asc" }, { model: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        offers: {
          select: {
            id: true,
            supplierId: true,
            priceDzd: true,
            condition: true,
            checkedAt: true,
            verificationStatus: true,
            supplier: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    items: rows.map((p) => ({
      id: p.id,
      category: p.category,
      brand: p.brand,
      model: p.model,
      cpuModel: p.cpuModel,
      ramGb: p.ramGb,
      storageMaxTb: p.storageMaxTb?.toString() ?? null,
      active: p.active,
      bestPrice: pickBestPrice(p.offers, now),
      observations: p.offers.length,
    })),
  };
}

export interface OfferView {
  id: string;
  supplierId: string;
  supplierName: string;
  priceDzd: string;
  condition: "new" | "refurbished" | "used";
  availability: string;
  warrantyMonths: number | null;
  locationWilayaCode: number | null;
  sourceUrl: string | null;
  quoteReference: string | null;
  checkedAt: Date;
  verificationStatus: "unverified" | "verified" | "rejected";
  verifiedAt: Date | null;
  notes: string | null;
  state: OfferState;
  /** True when it is the newest observation of its supplier (older ones are superseded). */
  current: boolean;
}

export async function getProduct(ctx: CrmContext, id: string, now = new Date()) {
  assertCan(ctx.actor, "catalog:read");
  const product = await getDb().product.findUnique({
    where: { id },
    include: {
      offers: {
        orderBy: [{ checkedAt: "desc" }, { createdAt: "desc" }],
        include: { supplier: { select: { name: true } } },
      },
    },
  });
  if (!product) throw notFound("Product");

  const seen = new Set<string>();
  const offers: OfferView[] = product.offers.map((o) => {
    const current = !seen.has(o.supplierId);
    seen.add(o.supplierId);
    return {
      id: o.id,
      supplierId: o.supplierId,
      supplierName: o.supplier.name,
      priceDzd: o.priceDzd.toString(),
      condition: o.condition,
      availability: o.availability,
      warrantyMonths: o.warrantyMonths,
      locationWilayaCode: o.locationWilayaCode,
      sourceUrl: o.sourceUrl,
      quoteReference: o.quoteReference,
      checkedAt: o.checkedAt,
      verificationStatus: o.verificationStatus,
      verifiedAt: o.verifiedAt,
      notes: o.notes,
      state: offerState(o, now),
      current,
    };
  });
  return { ...product, offers, bestPrice: pickBestPrice(product.offers, now) };
}

function toData(data: ReturnType<typeof productInput.parse>) {
  return {
    category: data.category,
    brand: data.brand,
    model: data.model,
    cpuModel: orNull(data.cpuModel),
    cpuCores: orNull(data.cpuCores),
    cpuBenchmark: orNull(data.cpuBenchmark),
    cpuBenchmarkSource: orNull(data.cpuBenchmarkSource),
    ramGb: orNull(data.ramGb),
    ramMaxGb: orNull(data.ramMaxGb),
    storageSlots: orNull(data.storageSlots),
    storageMaxTb: decimal(data.storageMaxTb),
    lanPorts: orNull(data.lanPorts),
    lanSpeedMbps: orNull(data.lanSpeedMbps),
    hasWifi: orNull(data.hasWifi),
    gpuClass: orNull(data.gpuClass),
    noiseClass: orNull(data.noiseClass),
    idleWatts: orNull(data.idleWatts),
    maxWatts: orNull(data.maxWatts),
    ecc: orNull(data.ecc),
    specsSource: orNull(data.specsSource),
    notes: orNull(data.notes),
  };
}

export async function createProduct(ctx: CrmContext, input: ProductInput) {
  assertCan(ctx.actor, "catalog:write");
  const actor = ctx.actor;
  const data = productInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const product = await tx.product.create({ data: { ...toData(data), createdById: actor.id } });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "product.created",
        "product",
        product.id,
        { category: data.category },
        ctx.client,
      ),
    });
    return product;
  });
}

export async function updateProduct(ctx: CrmContext, id: string, input: ProductInput) {
  assertCan(ctx.actor, "catalog:write");
  const actor = ctx.actor;
  const data = productInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const before = await tx.product.findUnique({ where: { id } });
    if (!before) throw notFound("Product");
    const next = toData(data);
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
      (k) => String(next[k] ?? null) !== String(before[k] ?? null),
    );
    const product = await tx.product.update({ where: { id }, data: next });
    await tx.auditLog.create({
      data: auditData(actor, "product.updated", "product", id, { changed }, ctx.client),
    });
    return product;
  });
}

/** Deactivating hides a product from lists and the advisor; its price history is kept. */
export async function setProductActive(ctx: CrmContext, id: string, active: boolean) {
  assertCan(ctx.actor, "catalog:write");
  const actor = ctx.actor;
  const db = getDb();

  await db.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id } });
    if (!product) throw notFound("Product");
    if (product.active === active) return;
    await tx.product.update({ where: { id }, data: { active } });
    await tx.auditLog.create({
      data: auditData(
        actor,
        active ? "product.reactivated" : "product.deactivated",
        "product",
        id,
        undefined,
        ctx.client,
      ),
    });
  });
}

/** Side-by-side comparison: the specs of 2-4 products and each one's best current price. */
export async function compareProducts(ctx: CrmContext, ids: string[], now = new Date()) {
  assertCan(ctx.actor, "catalog:read");
  const unique = [...new Set(ids)].slice(0, 4);
  const products = await getDb().product.findMany({
    where: { id: { in: unique } },
    include: {
      offers: {
        select: {
          id: true,
          supplierId: true,
          priceDzd: true,
          condition: true,
          checkedAt: true,
          verificationStatus: true,
          supplier: { select: { name: true } },
        },
      },
    },
  });
  // Keep the order the user chose.
  return unique
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map(({ offers, ...p }) => ({ ...p, bestPrice: pickBestPrice(offers, now) }));
}
