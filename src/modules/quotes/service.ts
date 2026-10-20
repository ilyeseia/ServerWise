import { Prisma } from "@/generated/prisma/client";
import { pickBestOffer } from "@/modules/catalog/products";
import { DEFAULT_FRESHNESS, isUsable, offerState, STRICT_USAGE } from "@/modules/catalog/freshness";
import { notFound, orNull, type CrmContext, type Page } from "@/modules/crm/context";
import { pageInput } from "@/modules/crm/schemas";
import { companySchema, COMPANY_KEY } from "@/modules/settings/service";
import { auditData } from "@/server/audit/tx";
import { assertCan, RuleViolationError } from "@/server/authz/guard";
import { getDb } from "@/server/db/client";
import { CALC_VERSION, calculateQuote, type CalcLineInput, type CalcResult } from "./calc";
import { isAllowedTaxRate, readPricing } from "./pricing";
import {
  createQuoteInput,
  decideInput,
  saveDraftInput,
  type CreateQuoteInput,
  type DecideInput,
  type ParsedLine,
  type SaveDraftInput,
} from "./schemas";

const DAY_MS = 86_400_000;

export type RevisionStatus = "draft" | "issued" | "accepted" | "rejected" | "superseded";
/** What people see: an issued revision past its validity date is "expired" (computed, no job). */
export type DisplayStatus = RevisionStatus | "expired";

export function displayStatus(
  revision: { status: RevisionStatus; validUntil: Date | null },
  now = new Date(),
): DisplayStatus {
  if (revision.status === "issued" && revision.validUntil && revision.validUntil < now) {
    return "expired";
  }
  return revision.status;
}

/** Allocates the next number of the year atomically (concurrent callers never share one). */
async function nextQuoteNumber(tx: Prisma.TransactionClient, now: Date): Promise<string> {
  const year = now.getUTCFullYear();
  const rows = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO "quote_counter" ("year", "last") VALUES (${year}, 1)
    ON CONFLICT ("year") DO UPDATE SET "last" = "quote_counter"."last" + 1
    RETURNING "last"`;
  return `Q-${year}-${String(rows[0]!.last).padStart(4, "0")}`;
}

type DbLine = {
  kind: "hardware" | "labor" | "service" | "other";
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  discountPct: Prisma.Decimal;
  taxRatePct: Prisma.Decimal;
  unitCost: Prisma.Decimal | null;
};

/** Runs the deterministic calculator over stored lines. */
export function calculateLines(lines: DbLine[]): CalcResult {
  return calculateQuote(
    lines.map((line): CalcLineInput => ({
      quantity: line.quantity.toFixed(3),
      unitPrice: line.unitPrice.toFixed(2),
      discountPct: line.discountPct.toFixed(2),
      taxRatePct: line.taxRatePct.toFixed(2),
      unitCost: line.unitCost ? line.unitCost.toFixed(2) : null,
    })),
  );
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

export interface QuoteListItem {
  id: string;
  number: string;
  title: string;
  leadId: string;
  leadTitle: string;
  customerId: string;
  customerName: string;
  revisionNumber: number;
  status: DisplayStatus;
  totalDzd: string;
  validUntil: Date | null;
  createdAt: Date;
}

export async function listQuotes(
  ctx: CrmContext,
  query: { leadId?: string; page?: number; pageSize?: number } = {},
  now = new Date(),
): Promise<Page<QuoteListItem>> {
  assertCan(ctx.actor, "quote:read");
  const { page, pageSize } = pageInput.parse({ page: query.page, pageSize: query.pageSize });
  const where: Prisma.QuoteWhereInput = query.leadId ? { leadId: query.leadId } : {};
  const db = getDb();
  const [total, rows] = await Promise.all([
    db.quote.count({ where }),
    db.quote.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        lead: { select: { title: true, customer: { select: { id: true, name: true } } } },
        revisions: { orderBy: { number: "desc" }, take: 1 },
      },
    }),
  ]);
  return {
    total,
    page,
    pageSize,
    items: rows.map((quote) => {
      const latest = quote.revisions[0]!;
      return {
        id: quote.id,
        number: quote.number,
        title: quote.title,
        leadId: quote.leadId,
        leadTitle: quote.lead.title,
        customerId: quote.lead.customer.id,
        customerName: quote.lead.customer.name,
        revisionNumber: latest.number,
        status: displayStatus(latest, now),
        totalDzd: latest.totalDzd.toFixed(2),
        validUntil: latest.validUntil,
        createdAt: quote.createdAt,
      };
    }),
  };
}

export interface RevisionView {
  id: string;
  number: number;
  status: DisplayStatus;
  storedStatus: RevisionStatus;
  notes: string | null;
  validUntil: Date | null;
  issuedAt: Date | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  subtotalDzd: string;
  discountDzd: string;
  taxDzd: string;
  totalDzd: string;
  lines: {
    id: string;
    position: number;
    kind: DbLine["kind"];
    description: string;
    quantity: string;
    unitPrice: string;
    discountPct: string;
    taxRatePct: string;
    unitCost: string | null;
    productId: string | null;
    offerId: string | null;
  }[];
  calculation: CalcResult;
}

function toRevisionView(
  revision: Prisma.QuoteRevisionGetPayload<{ include: { lines: true } }>,
  now: Date,
): RevisionView {
  const lines = [...revision.lines].sort((a, b) => a.position - b.position);
  return {
    id: revision.id,
    number: revision.number,
    status: displayStatus(revision, now),
    storedStatus: revision.status,
    notes: revision.notes,
    validUntil: revision.validUntil,
    issuedAt: revision.issuedAt,
    decidedAt: revision.decidedAt,
    decisionNote: revision.decisionNote,
    subtotalDzd: revision.subtotalDzd.toFixed(2),
    discountDzd: revision.discountDzd.toFixed(2),
    taxDzd: revision.taxDzd.toFixed(2),
    totalDzd: revision.totalDzd.toFixed(2),
    lines: lines.map((line) => ({
      id: line.id,
      position: line.position,
      kind: line.kind,
      description: line.description,
      quantity: line.quantity.toFixed(3),
      unitPrice: line.unitPrice.toFixed(2),
      discountPct: line.discountPct.toFixed(2),
      taxRatePct: line.taxRatePct.toFixed(2),
      unitCost: line.unitCost ? line.unitCost.toFixed(2) : null,
      productId: line.productId,
      offerId: line.offerId,
    })),
    calculation: calculateLines(lines),
  };
}

export async function getQuote(ctx: CrmContext, id: string, now = new Date()) {
  assertCan(ctx.actor, "quote:read");
  const quote = await getDb().quote.findUnique({
    where: { id },
    include: {
      lead: {
        select: {
          id: true,
          title: true,
          status: true,
          customer: { select: { id: true, name: true, legalName: true } },
        },
      },
      revisions: { orderBy: { number: "desc" }, include: { lines: true } },
    },
  });
  if (!quote) throw notFound("Quote");
  return {
    id: quote.id,
    number: quote.number,
    title: quote.title,
    createdAt: quote.createdAt,
    lead: quote.lead,
    revisions: quote.revisions.map((revision) => toRevisionView(revision, now)),
  };
}

/** The frozen snapshot of an issued revision (what was sent to the customer). */
export async function getIssuedSnapshot(ctx: CrmContext, revisionId: string) {
  assertCan(ctx.actor, "quote:read");
  const revision = await getDb().quoteRevision.findUnique({
    where: { id: revisionId },
    select: {
      id: true,
      number: true,
      status: true,
      snapshot: true,
      validUntil: true,
      quoteId: true,
    },
  });
  if (!revision) throw notFound("Revision");
  if (revision.status === "draft" || revision.snapshot === null) {
    throw new RuleViolationError("NOT_ISSUED", "The revision has not been issued");
  }
  return revision;
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

export async function createQuote(ctx: CrmContext, input: CreateQuoteInput, now = new Date()) {
  assertCan(ctx.actor, "quote:write");
  const actor = ctx.actor;
  const data = createQuoteInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: data.leadId } });
    if (!lead) throw notFound("Lead");
    if (lead.status === "won" || lead.status === "lost") {
      throw new RuleViolationError("LEAD_CLOSED", "A closed lead cannot receive a new quotation");
    }
    const number = await nextQuoteNumber(tx, now);
    const quote = await tx.quote.create({
      data: {
        number,
        leadId: lead.id,
        title: data.title,
        createdById: actor.id,
        revisions: { create: { number: 1, createdById: actor.id } },
      },
      include: { revisions: true },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "quote.created",
        "quote",
        quote.id,
        { number, leadId: lead.id },
        ctx.client,
      ),
    });
    return { id: quote.id, number, revisionId: quote.revisions[0]!.id };
  });
}

/** Cost and evidence for a hardware line come from a verified, fresh price observation. */
async function resolveOffer(
  tx: Prisma.TransactionClient,
  line: ParsedLine,
  now: Date,
): Promise<{ productId: string | null; offerId: string | null; unitCost: string | null }> {
  if (line.productId) {
    const product = await tx.product.findUnique({ where: { id: line.productId } });
    if (!product) throw notFound("Product");
    if (!product.active) {
      throw new RuleViolationError("PRODUCT_INACTIVE", "The product is deactivated");
    }
  }
  if (!line.offerId) {
    return { productId: line.productId ?? null, offerId: null, unitCost: line.unitCost ?? null };
  }
  if (line.kind !== "hardware" || !line.productId) {
    throw new RuleViolationError("OFFER_NEEDS_PRODUCT", "A price source needs a hardware product");
  }
  const offer = await tx.supplierOffer.findUnique({ where: { id: line.offerId } });
  if (!offer || offer.productId !== line.productId) throw notFound("Offer");
  if (!isUsable(offerState(offer, now, DEFAULT_FRESHNESS), STRICT_USAGE)) {
    throw new RuleViolationError("STALE_PRICE", "The supplier price is not verified and fresh");
  }
  return { productId: line.productId, offerId: offer.id, unitCost: offer.priceDzd.toFixed(2) };
}

/**
 * Replaces the lines (and notes) of a draft revision and recomputes its totals with the
 * deterministic calculator. The editor sends the whole list; the database refuses any change to
 * a revision that has been issued.
 */
export async function saveDraft(
  ctx: CrmContext,
  revisionId: string,
  input: SaveDraftInput,
  now = new Date(),
) {
  assertCan(ctx.actor, "quote:write");
  const actor = ctx.actor;
  const data = saveDraftInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const revision = await tx.quoteRevision.findUnique({ where: { id: revisionId } });
    if (!revision) throw notFound("Revision");
    if (revision.status !== "draft") {
      throw new RuleViolationError("REVISION_NOT_DRAFT", "Only a draft can be edited");
    }
    const pricing = await readPricing(tx);

    const resolved: Awaited<ReturnType<typeof resolveOffer>>[] = [];
    for (const line of data.lines) {
      if (!isAllowedTaxRate(pricing, line.taxRatePct)) {
        throw new RuleViolationError("TAX_RATE_NOT_ALLOWED", "This tax rate is not configured");
      }
      resolved.push(await resolveOffer(tx, line, now));
    }

    // Throws CalcError-free here: the schema already restricts formats; the calculator re-checks.
    const calculation = calculateQuote(
      data.lines.map((line, index) => ({
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountPct: line.discountPct,
        taxRatePct: line.taxRatePct,
        unitCost: resolved[index]!.unitCost,
      })),
    );

    await tx.quoteLine.deleteMany({ where: { revisionId } });
    if (data.lines.length > 0) {
      await tx.quoteLine.createMany({
        data: data.lines.map((line, index) => ({
          revisionId,
          position: index + 1,
          kind: line.kind,
          description: line.description,
          quantity: new Prisma.Decimal(line.quantity),
          unitPrice: new Prisma.Decimal(line.unitPrice),
          discountPct: new Prisma.Decimal(line.discountPct),
          taxRatePct: new Prisma.Decimal(line.taxRatePct),
          unitCost: resolved[index]!.unitCost
            ? new Prisma.Decimal(resolved[index]!.unitCost!)
            : null,
          productId: resolved[index]!.productId,
          offerId: resolved[index]!.offerId,
        })),
      });
    }
    await tx.quoteRevision.update({
      where: { id: revisionId },
      data: {
        notes: orNull(data.notes),
        subtotalDzd: new Prisma.Decimal(calculation.subtotal),
        discountDzd: new Prisma.Decimal(calculation.discountTotal),
        taxDzd: new Prisma.Decimal(calculation.taxTotal),
        totalDzd: new Prisma.Decimal(calculation.total),
      },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "quote.updated",
        "quote",
        revision.quoteId,
        { revision: revision.number, lines: data.lines.length },
        ctx.client,
      ),
    });
    return { calculation };
  });
}

/** Starts a new draft revision from the latest one (an issued revision itself never changes). */
export async function createRevision(ctx: CrmContext, quoteId: string) {
  assertCan(ctx.actor, "quote:write");
  const actor = ctx.actor;
  const db = getDb();

  return db.$transaction(async (tx) => {
    const quote = await tx.quote.findUnique({
      where: { id: quoteId },
      include: { lead: true, revisions: { orderBy: { number: "desc" }, include: { lines: true } } },
    });
    if (!quote) throw notFound("Quote");
    const latest = quote.revisions[0]!;
    if (latest.status === "draft") {
      throw new RuleViolationError("DRAFT_EXISTS", "A draft revision already exists");
    }
    if (quote.revisions.some((revision) => revision.status === "accepted")) {
      throw new RuleViolationError("QUOTE_ACCEPTED", "An accepted quotation cannot be revised");
    }
    if (quote.lead.status === "won" || quote.lead.status === "lost") {
      throw new RuleViolationError("LEAD_CLOSED", "A closed lead cannot receive a new revision");
    }
    const revision = await tx.quoteRevision.create({
      data: {
        quoteId,
        number: latest.number + 1,
        notes: latest.notes,
        createdById: actor.id,
        subtotalDzd: latest.subtotalDzd,
        discountDzd: latest.discountDzd,
        taxDzd: latest.taxDzd,
        totalDzd: latest.totalDzd,
        lines: {
          create: latest.lines.map((line) => ({
            position: line.position,
            kind: line.kind,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountPct: line.discountPct,
            taxRatePct: line.taxRatePct,
            unitCost: line.unitCost,
            productId: line.productId,
            offerId: line.offerId,
          })),
        },
      },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "quote.revision_created",
        "quote",
        quoteId,
        { revision: revision.number },
        ctx.client,
      ),
    });
    return { revisionId: revision.id, number: revision.number };
  });
}

/**
 * Freezes a draft. Everything is re-checked at this moment - prices must still be verified and
 * fresh - and the customer-facing document is stored as an immutable snapshot, so what was sent
 * can always be reproduced exactly.
 */
export async function issueRevision(ctx: CrmContext, revisionId: string, now = new Date()) {
  assertCan(ctx.actor, "quote:issue");
  const actor = ctx.actor;
  const db = getDb();

  return db.$transaction(async (tx) => {
    const revision = await tx.quoteRevision.findUnique({
      where: { id: revisionId },
      include: {
        lines: { orderBy: { position: "asc" } },
        quote: {
          include: {
            lead: {
              include: { customer: { include: { contacts: { where: { isPrimary: true } } } } },
            },
          },
        },
      },
    });
    if (!revision) throw notFound("Revision");
    if (revision.status !== "draft") {
      throw new RuleViolationError("REVISION_NOT_DRAFT", "Only a draft can be issued");
    }
    if (revision.lines.length === 0) {
      throw new RuleViolationError("NO_LINES", "A quotation needs at least one line");
    }
    const pricing = await readPricing(tx);
    const calculation = calculateLines(revision.lines);

    // Prices must still be trustworthy today, not just when the line was added.
    const offerIds = revision.lines.flatMap((line) => (line.offerId ? [line.offerId] : []));
    const offers = await tx.supplierOffer.findMany({
      where: { id: { in: offerIds } },
      include: { supplier: { select: { name: true } } },
    });
    const offerById = new Map(offers.map((offer) => [offer.id, offer]));
    for (const line of revision.lines) {
      if (!line.offerId) continue;
      const offer = offerById.get(line.offerId);
      if (!offer || !isUsable(offerState(offer, now, DEFAULT_FRESHNESS), STRICT_USAGE)) {
        throw new RuleViolationError(
          "STALE_PRICE",
          `Line ${line.position}: price is no longer fresh`,
        );
      }
    }

    if (
      pricing.minMarginPct !== null &&
      calculation.margin?.pct != null &&
      Number(calculation.margin.pct) < Number(pricing.minMarginPct) &&
      actor.role !== "owner"
    ) {
      throw new RuleViolationError("MARGIN_TOO_LOW", "The margin is below the configured minimum");
    }

    const productIds = revision.lines.flatMap((line) => (line.productId ? [line.productId] : []));
    const products = await tx.product.findMany({ where: { id: { in: productIds } } });
    const productById = new Map(products.map((product) => [product.id, product]));

    const companyRow = await tx.appSetting.findUnique({ where: { key: COMPANY_KEY } });
    const company = companySchema.safeParse(companyRow?.value);
    const customer = revision.quote.lead.customer;
    const issuedAt = now;
    const validUntil = new Date(issuedAt.getTime() + pricing.validityDays * DAY_MS);

    const snapshot = {
      calcVersion: CALC_VERSION,
      currency: "DZD",
      number: revision.quote.number,
      revision: revision.number,
      title: revision.quote.title,
      issuedAt: issuedAt.toISOString(),
      validUntil: validUntil.toISOString(),
      validityDays: pricing.validityDays,
      notes: revision.notes,
      company: company.success ? company.data : { name: "", phone: "", address: "" },
      customer: {
        id: customer.id,
        name: customer.name,
        legalName: customer.legalName,
        phone: customer.phone,
        email: customer.email,
        wilayaCode: customer.wilayaCode,
        contact: customer.contacts[0]?.name ?? null,
      },
      lead: { id: revision.quote.lead.id, title: revision.quote.lead.title },
      lines: revision.lines.map((line, index) => {
        const offer = line.offerId ? offerById.get(line.offerId) : undefined;
        const product = line.productId ? productById.get(line.productId) : undefined;
        return {
          position: line.position,
          kind: line.kind,
          description: line.description,
          quantity: line.quantity.toFixed(3),
          unitPrice: line.unitPrice.toFixed(2),
          discountPct: line.discountPct.toFixed(2),
          taxRatePct: line.taxRatePct.toFixed(2),
          calc: calculation.lines[index],
          product: product ? `${product.brand} ${product.model}` : null,
          // Evidence behind the cost: kept for staff, not printed on the customer's copy.
          source: offer
            ? {
                offerId: offer.id,
                supplier: offer.supplier.name,
                sourceUrl: offer.sourceUrl,
                quoteReference: offer.quoteReference,
                checkedAt: offer.checkedAt.toISOString(),
                verifiedAt: offer.verifiedAt?.toISOString() ?? null,
              }
            : null,
        };
      }),
      totals: {
        subtotal: calculation.subtotal,
        discount: calculation.discountTotal,
        tax: calculation.taxTotal,
        total: calculation.total,
      },
      margin: calculation.margin,
    };

    // Older issued revisions of this quote are replaced by this one.
    await tx.quoteRevision.updateMany({
      where: { quoteId: revision.quoteId, status: "issued" },
      data: { status: "superseded" },
    });
    const issued = await tx.quoteRevision.update({
      where: { id: revisionId },
      data: {
        status: "issued",
        issuedAt,
        issuedById: actor.id,
        validUntil,
        subtotalDzd: new Prisma.Decimal(calculation.subtotal),
        discountDzd: new Prisma.Decimal(calculation.discountTotal),
        taxDzd: new Prisma.Decimal(calculation.taxTotal),
        totalDzd: new Prisma.Decimal(calculation.total),
        snapshot,
      },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "quote.issued",
        "quote",
        revision.quoteId,
        { revision: revision.number, number: revision.quote.number, total: calculation.total },
        ctx.client,
      ),
    });
    return { revisionId: issued.id, validUntil, total: calculation.total };
  });
}

/** Records the customer's answer on an issued, still valid revision. The answer is final. */
export async function decideRevision(
  ctx: CrmContext,
  revisionId: string,
  input: DecideInput,
  now = new Date(),
) {
  assertCan(ctx.actor, "quote:decide");
  const actor = ctx.actor;
  const data = decideInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const revision = await tx.quoteRevision.findUnique({
      where: { id: revisionId },
      include: { quote: true },
    });
    if (!revision) throw notFound("Revision");
    if (revision.status !== "issued") {
      throw new RuleViolationError("NOT_ISSUED", "Only an issued revision can be answered");
    }
    if (revision.validUntil && revision.validUntil < now) {
      throw new RuleViolationError("QUOTE_EXPIRED", "This quotation has expired");
    }
    await tx.quoteRevision.update({
      where: { id: revisionId },
      data: {
        status: data.decision,
        decidedAt: now,
        decidedById: actor.id,
        decisionNote: orNull(data.note),
      },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        data.decision === "accepted" ? "quote.accepted" : "quote.rejected",
        "quote",
        revision.quoteId,
        { revision: revision.number, number: revision.quote.number },
        ctx.client,
      ),
    });
    return { status: data.decision };
  });
}

/**
 * Suggests a hardware line for a product: its cheapest verified, fresh price is the cost, and the
 * selling price is suggested only when the owner configured a markup. Nothing is invented: with no
 * usable price the answer says so.
 */
export async function suggestHardwareLine(ctx: CrmContext, productId: string, now = new Date()) {
  assertCan(ctx.actor, "quote:write");
  assertCan(ctx.actor, "catalog:read");
  const db = getDb();
  const product = await db.product.findUnique({
    where: { id: productId },
    include: { offers: { include: { supplier: { select: { name: true } } } } },
  });
  if (!product) throw notFound("Product");
  if (!product.active)
    throw new RuleViolationError("PRODUCT_INACTIVE", "The product is deactivated");
  const pricing = await readPricing();
  const best = pickBestOffer(product.offers, now);
  if (!best) {
    return {
      productId,
      description: `${product.brand} ${product.model}`,
      offer: null,
      suggestedUnitPrice: null as string | null,
    };
  }
  const cost = new Prisma.Decimal(best.priceDzd);
  const suggested =
    pricing.markupPct === null
      ? null
      : cost
          .times(new Prisma.Decimal(100).plus(pricing.markupPct))
          .dividedBy(100)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
          .toFixed(2);
  return {
    productId,
    description: `${product.brand} ${product.model}`,
    offer: {
      id: best.id,
      costDzd: cost.toFixed(2),
      supplierName: best.supplier.name,
      checkedAt: best.checkedAt,
    },
    suggestedUnitPrice: suggested,
  };
}
