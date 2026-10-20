import { Prisma } from "@/generated/prisma/client";
import { notFound, orNull, type CrmContext } from "@/modules/crm/context";
import { auditData } from "@/server/audit/tx";
import { assertCan, RuleViolationError } from "@/server/authz/guard";
import { getDb } from "@/server/db/client";
import { offerInput, type OfferInput } from "./schemas";

/** Allow a few minutes of clock difference between the browser and the server. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

/**
 * Records a price observation. It is evidence-backed (a link or a quotation reference is
 * required, also enforced by the database) and starts as "unverified". Observations are never
 * edited: to change a price, record a new one - the old one stays as history.
 */
export async function recordOffer(ctx: CrmContext, input: OfferInput) {
  assertCan(ctx.actor, "catalog:write");
  const actor = ctx.actor;
  const data = offerInput.parse(input);

  if (data.checkedAt.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
    throw new RuleViolationError("FUTURE_DATE", "A price cannot be checked in the future");
  }
  const db = getDb();

  return db.$transaction(async (tx) => {
    const [product, supplier] = await Promise.all([
      tx.product.findUnique({ where: { id: data.productId } }),
      tx.supplier.findUnique({ where: { id: data.supplierId } }),
    ]);
    if (!product) throw notFound("Product");
    if (!supplier) throw notFound("Supplier");
    if (!product.active)
      throw new RuleViolationError("PRODUCT_INACTIVE", "The product is deactivated");
    if (!supplier.active)
      throw new RuleViolationError("SUPPLIER_INACTIVE", "The supplier is deactivated");

    const offer = await tx.supplierOffer.create({
      data: {
        productId: data.productId,
        supplierId: data.supplierId,
        priceDzd: new Prisma.Decimal(data.priceDzd),
        condition: data.condition,
        availability: data.availability,
        warrantyMonths: orNull(data.warrantyMonths),
        locationWilayaCode: orNull(data.locationWilayaCode),
        sourceUrl: orNull(data.sourceUrl),
        quoteReference: orNull(data.quoteReference),
        checkedAt: data.checkedAt,
        notes: orNull(data.notes),
        createdById: actor.id,
      },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "offer.recorded",
        "offer",
        offer.id,
        { productId: data.productId, supplierId: data.supplierId },
        ctx.client,
      ),
    });
    return offer;
  });
}

/**
 * Confirms (or rejects) a recorded price after checking its source. The decision is final -
 * the database refuses to change it - so a mistake is corrected by a new observation.
 */
export async function decideOffer(
  ctx: CrmContext,
  offerId: string,
  decision: "verified" | "rejected",
) {
  assertCan(ctx.actor, "catalog:verify");
  const actor = ctx.actor;
  if (decision !== "verified" && decision !== "rejected") {
    throw new RuleViolationError("INVALID_DECISION", "Unknown decision");
  }
  const db = getDb();

  return db.$transaction(async (tx) => {
    const offer = await tx.supplierOffer.findUnique({ where: { id: offerId } });
    if (!offer) throw notFound("Offer");
    if (offer.verificationStatus !== "unverified") {
      throw new RuleViolationError(
        "ALREADY_DECIDED",
        "This price has already been verified or rejected",
      );
    }
    const updated = await tx.supplierOffer.update({
      where: { id: offerId },
      data: { verificationStatus: decision, verifiedAt: new Date(), verifiedById: actor.id },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        decision === "verified" ? "offer.verified" : "offer.rejected",
        "offer",
        offerId,
        { productId: offer.productId, supplierId: offer.supplierId },
        ctx.client,
      ),
    });
    return updated;
  });
}
