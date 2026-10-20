import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideOffer, recordOffer } from "@/modules/catalog/offers";
import { createProduct, setProductActive } from "@/modules/catalog/products";
import type { ProductInput } from "@/modules/catalog/schemas";
import { createSupplier } from "@/modules/catalog/suppliers";
import { createCustomer } from "@/modules/crm/customers";
import { changeLeadStatus, createLead } from "@/modules/crm/leads";
import {
  PRICING_KEY,
  getPricing,
  updatePricing,
  type PricingSettings,
} from "@/modules/quotes/pricing";
import {
  createQuote,
  createRevision,
  decideRevision,
  displayStatus,
  getIssuedSnapshot,
  getQuote,
  issueRevision,
  listQuotes,
  saveDraft,
  suggestHardwareLine,
} from "@/modules/quotes/service";
import { ForbiddenError, UnauthorizedError } from "@/server/authz/guard";
import { getDb } from "@/server/db/client";
import {
  auditCount,
  createStaff,
  deleteCatalog,
  deleteCustomers,
  unique,
  type TestStaff,
} from "./crm-helpers";
import { deleteTestUsers } from "./helpers";

let owner: TestStaff;
let sales: TestStaff;
let technician: TestStaff;
let viewer: TestStaff;
const customerIds: string[] = [];
const productIds: string[] = [];
const supplierIds: string[] = [];
let savedPricing: unknown;

const anonymous = { actor: undefined };
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);

const PRICING: PricingSettings = {
  validityDays: 10,
  taxRatesPct: ["9", "19"],
  defaultTaxRatePct: "19",
  markupPct: "20",
  minMarginPct: null,
  laborRateDzdPerHour: "2500.00",
};

const line = (over: Record<string, unknown> = {}) => ({
  kind: "service" as const,
  description: "Installation",
  quantity: "1",
  unitPrice: "1000",
  ...over,
});

async function newLead() {
  const customer = await createCustomer(sales.ctx, { type: "individual", name: unique("Quote") });
  customerIds.push(customer.id);
  return createLead(sales.ctx, { customerId: customer.id, title: unique("Lead") });
}

/** A quote with an empty draft, ready for saveDraft. */
async function newQuote() {
  const lead = await newLead();
  const quote = await createQuote(sales.ctx, { leadId: lead.id, title: "Home server" });
  return { lead, ...quote };
}

/** A product with one verified, fresh supplier price (cost 90 000). */
async function productWithPrice(price = 90_000) {
  const product = await createProduct(sales.ctx, {
    category: "nas",
    brand: unique("Brand"),
    model: "Q-1",
  } as ProductInput);
  productIds.push(product.id);
  const supplier = await createSupplier(sales.ctx, { name: unique("Supplier"), kind: "retailer" });
  supplierIds.push(supplier.id);
  const offer = await recordOffer(sales.ctx, {
    productId: product.id,
    supplierId: supplier.id,
    priceDzd: price,
    condition: "new",
    sourceUrl: "https://example.test/listing",
    checkedAt: daysAgo(1),
  });
  await decideOffer(owner.ctx, offer.id, "verified");
  return { product, supplier, offer };
}

async function setOwnerPricing(over: Partial<PricingSettings> = {}) {
  await updatePricing(owner.ctx, { ...PRICING, ...over });
}

describe("quotations (integration)", () => {
  beforeAll(async () => {
    [owner, sales, technician, viewer] = await Promise.all([
      createStaff("owner"),
      createStaff("sales"),
      createStaff("technician"),
      createStaff("viewer"),
    ]);
    savedPricing = (await getDb().appSetting.findUnique({ where: { key: PRICING_KEY } }))?.value;
    await setOwnerPricing();
  });

  afterAll(async () => {
    const db = getDb();
    if (savedPricing === undefined) {
      await db.appSetting.deleteMany({ where: { key: PRICING_KEY } });
    } else {
      await db.appSetting.update({
        where: { key: PRICING_KEY },
        data: { value: savedPricing as never },
      });
    }
    await deleteCustomers(customerIds);
    await deleteCatalog(productIds, supplierIds);
    await deleteTestUsers([owner, sales, technician, viewer].map((s) => s.user));
    await db.$disconnect();
  });

  // ---------------------------------------------------------------------------------------
  describe("authorization", () => {
    it("rejects anonymous callers everywhere", async () => {
      const { id, revisionId } = await newQuote();
      for (const call of [
        () => listQuotes(anonymous),
        () => getQuote(anonymous, id),
        () => createQuote(anonymous, { leadId: id, title: "x" }),
        () => saveDraft(anonymous, revisionId, { lines: [] }),
        () => issueRevision(anonymous, revisionId),
        () => createRevision(anonymous, id),
        () => decideRevision(anonymous, revisionId, { decision: "accepted" }),
        () => getPricing(anonymous),
        () => updatePricing(anonymous, PRICING),
      ]) {
        await expect(call()).rejects.toBeInstanceOf(UnauthorizedError);
      }
    });

    it("viewers see nothing; technicians read but never change", async () => {
      const { id, revisionId } = await newQuote();
      await expect(listQuotes(viewer.ctx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getQuote(viewer.ctx, id)).rejects.toBeInstanceOf(ForbiddenError);

      await expect(getQuote(technician.ctx, id)).resolves.toMatchObject({ id });
      await expect(listQuotes(technician.ctx)).resolves.toBeDefined();
      await expect(
        saveDraft(technician.ctx, revisionId, { lines: [line()] }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(issueRevision(technician.ctx, revisionId)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(createRevision(technician.ctx, id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        decideRevision(technician.ctx, revisionId, { decision: "accepted" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("only the owner may change the pricing configuration", async () => {
      await expect(updatePricing(sales.ctx, PRICING)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getPricing(sales.ctx)).resolves.toMatchObject({ validityDays: 10 });
      await expect(getPricing(viewer.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("pricing configuration", () => {
    it("validates, stores and audits it", async () => {
      await setOwnerPricing({ validityDays: 12 });
      await expect(getPricing(owner.ctx)).resolves.toMatchObject({
        validityDays: 12,
        taxRatesPct: ["9", "19"],
      });
      expect(await auditCount("settings.updated", PRICING_KEY)).toBeGreaterThan(0);
      await setOwnerPricing();
    });

    it("rejects nonsense", async () => {
      for (const bad of [
        { validityDays: 0 },
        { validityDays: 400 },
        { taxRatesPct: ["19", "19.0"] },
        { taxRatesPct: ["abc"] },
        { taxRatesPct: ["101"] },
        { defaultTaxRatePct: "7" }, // not in the list
        { markupPct: "-5" },
        { laborRateDzdPerHour: "12.345" },
      ]) {
        await expect(
          updatePricing(owner.ctx, { ...PRICING, ...bad }),
          JSON.stringify(bad),
        ).rejects.toThrow();
      }
    });

    it("starts unconfigured: no tax rates are invented", async () => {
      const db = getDb();
      await db.appSetting.deleteMany({ where: { key: PRICING_KEY } });
      try {
        const pricing = await getPricing(owner.ctx);
        expect(pricing.taxRatesPct).toEqual([]);
        expect(pricing.defaultTaxRatePct).toBeNull();
        expect(pricing.markupPct).toBeNull();
      } finally {
        await setOwnerPricing();
      }
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("creating quotes", () => {
    it("allocates unique sequential numbers and starts a draft revision", async () => {
      const a = await newQuote();
      const b = await newQuote();
      expect(a.number).toMatch(/^Q-\d{4}-\d{4}$/);
      expect(b.number).not.toBe(a.number);
      expect(Number(b.number.slice(-4))).toBeGreaterThan(Number(a.number.slice(-4)));

      const view = await getQuote(sales.ctx, a.id);
      expect(view.revisions).toHaveLength(1);
      expect(view.revisions[0]).toMatchObject({ number: 1, status: "draft", totalDzd: "0.00" });
      expect(await auditCount("quote.created", a.id)).toBe(1);
    });

    it("never hands the same number to concurrent callers", async () => {
      const leads = await Promise.all([newLead(), newLead(), newLead(), newLead()]);
      const quotes = await Promise.all(
        leads.map((lead) => createQuote(sales.ctx, { leadId: lead.id, title: "Parallel" })),
      );
      expect(new Set(quotes.map((q) => q.number)).size).toBe(4);
    });

    it("refuses a closed lead and unknown leads", async () => {
      const lead = await newLead();
      await changeLeadStatus(sales.ctx, lead.id, "lost", { lostReason: "no budget" });
      await expect(
        createQuote(sales.ctx, { leadId: lead.id, title: "Late" }),
      ).rejects.toMatchObject({ code: "LEAD_CLOSED" });
      await expect(
        createQuote(sales.ctx, { leadId: crypto.randomUUID(), title: "Ghost" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(createQuote(sales.ctx, { leadId: lead.id, title: " " })).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("editing a draft", () => {
    it("computes totals with the deterministic calculator and replaces lines", async () => {
      const { revisionId, id } = await newQuote();
      const first = await saveDraft(sales.ctx, revisionId, {
        notes: "  Payment on delivery ",
        lines: [
          line({ quantity: "2", unitPrice: "1500.50", taxRatePct: "19" }),
          line({ unitPrice: "1000", discountPct: "10", taxRatePct: "9" }),
        ],
      });
      // 3001.00 + 900.00 ; tax 570.19 + 81.00
      expect(first.calculation).toMatchObject({
        subtotal: "3901.00",
        taxTotal: "651.19",
        total: "4552.19",
      });

      const view = await getQuote(sales.ctx, id);
      expect(view.revisions[0]).toMatchObject({
        subtotalDzd: "3901.00",
        taxDzd: "651.19",
        totalDzd: "4552.19",
        notes: "Payment on delivery",
      });
      expect(view.revisions[0]!.lines).toHaveLength(2);

      await saveDraft(sales.ctx, revisionId, { lines: [line()] });
      const again = await getQuote(sales.ctx, id);
      expect(again.revisions[0]!.lines).toHaveLength(1);
      expect(again.revisions[0]!.totalDzd).toBe("1000.00");
      expect(await auditCount("quote.updated", id)).toBe(2);
    });

    it("rejects tax rates the owner has not configured (zero is always allowed)", async () => {
      const { revisionId } = await newQuote();
      await expect(
        saveDraft(sales.ctx, revisionId, { lines: [line({ taxRatePct: "7" })] }),
      ).rejects.toMatchObject({ code: "TAX_RATE_NOT_ALLOWED" });
      await expect(
        saveDraft(sales.ctx, revisionId, { lines: [line({ taxRatePct: "0" })] }),
      ).resolves.toBeDefined();
    });

    it("rejects malformed amounts before they reach the calculator", async () => {
      const { revisionId } = await newQuote();
      for (const bad of [
        { quantity: "0" },
        { quantity: "-1" },
        { quantity: "1e3" },
        { unitPrice: "-5" },
        { unitPrice: "10.999" },
        { discountPct: "101" },
        { description: "   " },
      ]) {
        await expect(
          saveDraft(sales.ctx, revisionId, { lines: [line(bad)] }),
          JSON.stringify(bad),
        ).rejects.toThrow();
      }
    });

    it("takes the cost of a hardware line from a verified, fresh observation", async () => {
      const { product, offer } = await productWithPrice(90_000);
      const { revisionId, id } = await newQuote();
      const saved = await saveDraft(sales.ctx, revisionId, {
        lines: [
          line({
            kind: "hardware",
            description: "NAS",
            unitPrice: "110000",
            unitCost: "1", // ignored: the evidence wins
            productId: product.id,
            offerId: offer.id,
          }),
        ],
      });
      expect(saved.calculation.margin).toEqual({ amount: "20000.00", pct: "18.18" });
      const view = await getQuote(sales.ctx, id);
      expect(view.revisions[0]!.lines[0]).toMatchObject({
        unitCost: "90000.00",
        offerId: offer.id,
        productId: product.id,
      });
    });

    it("refuses prices that are unverified, mismatched, or attached to non-hardware lines", async () => {
      const { product } = await productWithPrice();
      const other = await productWithPrice();
      const supplier = await createSupplier(sales.ctx, { name: unique("S"), kind: "retailer" });
      supplierIds.push(supplier.id);
      const unverified = await recordOffer(sales.ctx, {
        productId: product.id,
        supplierId: supplier.id,
        priceDzd: 50_000,
        condition: "new",
        sourceUrl: "https://example.test/u",
        checkedAt: daysAgo(0),
      });
      const { revisionId } = await newQuote();
      const hw = (over: Record<string, unknown>) =>
        saveDraft(sales.ctx, revisionId, {
          lines: [line({ kind: "hardware", productId: product.id, ...over })],
        });

      await expect(hw({ offerId: unverified.id })).rejects.toMatchObject({ code: "STALE_PRICE" });
      await expect(hw({ offerId: other.offer.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        saveDraft(sales.ctx, revisionId, {
          lines: [line({ kind: "labor", productId: product.id, offerId: unverified.id })],
        }),
      ).rejects.toMatchObject({ code: "OFFER_NEEDS_PRODUCT" });
    });

    it("refuses inactive products", async () => {
      const { product } = await productWithPrice();
      await setProductActive(sales.ctx, product.id, false);
      const { revisionId } = await newQuote();
      await expect(
        saveDraft(sales.ctx, revisionId, {
          lines: [line({ kind: "hardware", productId: product.id })],
        }),
      ).rejects.toMatchObject({ code: "PRODUCT_INACTIVE" });
      await expect(suggestHardwareLine(sales.ctx, product.id)).rejects.toMatchObject({
        code: "PRODUCT_INACTIVE",
      });
    });

    it("cannot edit a revision once it was issued", async () => {
      const { revisionId } = await newQuote();
      await saveDraft(sales.ctx, revisionId, { lines: [line()] });
      await issueRevision(sales.ctx, revisionId);
      await expect(saveDraft(sales.ctx, revisionId, { lines: [line()] })).rejects.toMatchObject({
        code: "REVISION_NOT_DRAFT",
      });
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("issuing", () => {
    it("needs at least one line", async () => {
      const { revisionId } = await newQuote();
      await expect(issueRevision(sales.ctx, revisionId)).rejects.toMatchObject({
        code: "NO_LINES",
      });
    });

    it("freezes a snapshot with validity, totals and price evidence", async () => {
      const { product, offer } = await productWithPrice(90_000);
      const { revisionId, id, number } = await newQuote();
      await saveDraft(sales.ctx, revisionId, {
        notes: "Delivery in 7 days",
        lines: [
          line({
            kind: "hardware",
            description: "NAS",
            unitPrice: "110000",
            taxRatePct: "19",
            productId: product.id,
            offerId: offer.id,
          }),
          line({ unitPrice: "5000", taxRatePct: "19" }),
        ],
      });
      const now = new Date();
      const issued = await issueRevision(sales.ctx, revisionId, now);
      expect(issued.total).toBe("136850.00"); // 115000 + 21850

      const view = await getQuote(sales.ctx, id);
      const revision = view.revisions[0]!;
      expect(revision.storedStatus).toBe("issued");
      expect(revision.validUntil!.getTime()).toBe(now.getTime() + 10 * 86_400_000);

      const { snapshot } = await getIssuedSnapshot(sales.ctx, revisionId);
      expect(snapshot).toMatchObject({
        number,
        revision: 1,
        currency: "DZD",
        calcVersion: 1,
        notes: "Delivery in 7 days",
        totals: { subtotal: "115000.00", tax: "21850.00", total: "136850.00" },
        margin: null, // the service line has no known cost: margin is not guessed
      });
      const frozen = snapshot as { lines: { source: { offerId: string } | null }[] };
      expect(frozen.lines[0]!.source).toMatchObject({ offerId: offer.id });
      expect(frozen.lines[1]!.source).toBeNull();
      expect(await auditCount("quote.issued", id)).toBe(1);
    });

    it("requires prices to still be fresh at the moment of issue", async () => {
      const { product, offer } = await productWithPrice();
      const { revisionId } = await newQuote();
      await saveDraft(sales.ctx, revisionId, {
        lines: [
          line({ kind: "hardware", unitPrice: "120000", productId: product.id, offerId: offer.id }),
        ],
      });
      await expect(issueRevision(sales.ctx, revisionId, inDays(30))).rejects.toMatchObject({
        code: "STALE_PRICE",
      });
      await expect(issueRevision(sales.ctx, revisionId)).resolves.toBeDefined();
    });

    it("enforces the minimum margin for sales but lets the owner decide", async () => {
      const { product, offer } = await productWithPrice(100_000);
      await setOwnerPricing({ minMarginPct: "15" });
      try {
        const lowMargin = async () => {
          const { revisionId } = await newQuote();
          await saveDraft(sales.ctx, revisionId, {
            lines: [
              line({
                kind: "hardware",
                unitPrice: "105000", // 4.76 % margin
                productId: product.id,
                offerId: offer.id,
              }),
            ],
          });
          return revisionId;
        };
        const a = await lowMargin();
        await expect(issueRevision(sales.ctx, a)).rejects.toMatchObject({ code: "MARGIN_TOO_LOW" });
        await expect(issueRevision(owner.ctx, a)).resolves.toBeDefined();

        const { revisionId: ok } = await newQuote();
        await saveDraft(sales.ctx, ok, {
          lines: [
            line({
              kind: "hardware",
              unitPrice: "130000",
              productId: product.id,
              offerId: offer.id,
            }),
          ],
        });
        await expect(issueRevision(sales.ctx, ok)).resolves.toBeDefined();
      } finally {
        await setOwnerPricing();
      }
    });

    it("cannot be issued twice", async () => {
      const { revisionId } = await newQuote();
      await saveDraft(sales.ctx, revisionId, { lines: [line()] });
      await issueRevision(sales.ctx, revisionId);
      await expect(issueRevision(sales.ctx, revisionId)).rejects.toMatchObject({
        code: "REVISION_NOT_DRAFT",
      });
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("revisions", () => {
    it("copies the latest revision, allows one draft, and supersedes on issue", async () => {
      const { revisionId, id } = await newQuote();
      await saveDraft(sales.ctx, revisionId, { lines: [line({ unitPrice: "1000" })] });
      await issueRevision(sales.ctx, revisionId);

      const second = await createRevision(sales.ctx, id);
      expect(second.number).toBe(2);
      await expect(createRevision(sales.ctx, id)).rejects.toMatchObject({ code: "DRAFT_EXISTS" });

      const copied = await getQuote(sales.ctx, id);
      expect(copied.revisions[0]!.lines).toHaveLength(1);
      expect(copied.revisions[0]!.totalDzd).toBe("1000.00");

      await saveDraft(sales.ctx, second.revisionId, { lines: [line({ unitPrice: "1200" })] });
      await issueRevision(sales.ctx, second.revisionId);

      const final = await getQuote(sales.ctx, id);
      expect(final.revisions.map((r) => [r.number, r.storedStatus])).toEqual([
        [2, "issued"],
        [1, "superseded"],
      ]);
      // The first revision still shows exactly what was issued.
      expect(final.revisions[1]!.totalDzd).toBe("1000.00");
      expect(await auditCount("quote.revision_created", id)).toBe(1);
    });

    it("cannot start before the previous revision was issued, or on a closed lead", async () => {
      const { id, lead, revisionId } = await newQuote();
      await expect(createRevision(sales.ctx, id)).rejects.toMatchObject({ code: "DRAFT_EXISTS" });
      await saveDraft(sales.ctx, revisionId, { lines: [line()] });
      await issueRevision(sales.ctx, revisionId);
      await changeLeadStatus(sales.ctx, lead.id, "lost", { lostReason: "chose a competitor" });
      await expect(createRevision(sales.ctx, id)).rejects.toMatchObject({ code: "LEAD_CLOSED" });
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("customer decision", () => {
    async function issued() {
      const quote = await newQuote();
      await saveDraft(sales.ctx, quote.revisionId, { lines: [line()] });
      await issueRevision(sales.ctx, quote.revisionId);
      return quote;
    }

    it("records an acceptance once, finally, with an audit trail", async () => {
      const { revisionId, id } = await issued();
      await decideRevision(sales.ctx, revisionId, { decision: "accepted", note: " signed " });
      const view = await getQuote(sales.ctx, id);
      expect(view.revisions[0]).toMatchObject({
        storedStatus: "accepted",
        decisionNote: "signed",
      });
      expect(view.revisions[0]!.decidedAt).toBeInstanceOf(Date);
      await expect(
        decideRevision(sales.ctx, revisionId, { decision: "rejected" }),
      ).rejects.toMatchObject({ code: "NOT_ISSUED" });
      await expect(createRevision(sales.ctx, id)).rejects.toMatchObject({ code: "QUOTE_ACCEPTED" });
      expect(await auditCount("quote.accepted", id)).toBe(1);
    });

    it("a rejected quotation can be revised", async () => {
      const { revisionId, id } = await issued();
      await decideRevision(sales.ctx, revisionId, { decision: "rejected" });
      expect(await auditCount("quote.rejected", id)).toBe(1);
      await expect(createRevision(sales.ctx, id)).resolves.toMatchObject({ number: 2 });
    });

    it("cannot answer a draft or an expired quotation", async () => {
      const draft = await newQuote();
      await expect(
        decideRevision(sales.ctx, draft.revisionId, { decision: "accepted" }),
      ).rejects.toMatchObject({ code: "NOT_ISSUED" });

      const { revisionId, id } = await issued();
      await expect(
        decideRevision(sales.ctx, revisionId, { decision: "accepted" }, inDays(30)),
      ).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
      const view = await getQuote(sales.ctx, id, inDays(30));
      expect(view.revisions[0]!.status).toBe("expired");
      expect(displayStatus({ status: "draft", validUntil: null })).toBe("draft");
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("suggested hardware lines", () => {
    it("suggests cost and, only when a markup is configured, a selling price", async () => {
      const { product, offer } = await productWithPrice(90_000);
      const withMarkup = await suggestHardwareLine(sales.ctx, product.id);
      expect(withMarkup.offer).toMatchObject({ id: offer.id, costDzd: "90000.00" });
      expect(withMarkup.suggestedUnitPrice).toBe("108000.00"); // +20 %

      await setOwnerPricing({ markupPct: null });
      try {
        const without = await suggestHardwareLine(sales.ctx, product.id);
        expect(without.suggestedUnitPrice).toBeNull();
      } finally {
        await setOwnerPricing();
      }
    });

    it("reports no offer when nothing is verified and fresh", async () => {
      const bare = await createProduct(sales.ctx, {
        category: "server",
        brand: unique("Bare"),
        model: "B-1",
      } as ProductInput);
      productIds.push(bare.id);
      const result = await suggestHardwareLine(sales.ctx, bare.id);
      expect(result.offer).toBeNull();
      expect(result.suggestedUnitPrice).toBeNull();
      await expect(suggestHardwareLine(viewer.ctx, bare.id)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("listing", () => {
    it("lists quotes with their latest revision, optionally per lead", async () => {
      const { lead, id, number } = await newQuote();
      const result = await listQuotes(sales.ctx, { leadId: lead.id });
      expect(result.total).toBe(1);
      expect(result.items[0]).toMatchObject({
        id,
        number,
        revisionNumber: 1,
        status: "draft",
        totalDzd: "0.00",
      });
      expect((await listQuotes(sales.ctx, { pageSize: 5 })).items.length).toBeLessThanOrEqual(5);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("database guarantees (bypassing the application)", () => {
    async function issuedQuote() {
      const quote = await newQuote();
      await saveDraft(sales.ctx, quote.revisionId, {
        lines: [line({ unitPrice: "2000", taxRatePct: "19" })],
      });
      await issueRevision(sales.ctx, quote.revisionId);
      const lineRow = await getDb().quoteLine.findFirstOrThrow({
        where: { revisionId: quote.revisionId },
      });
      return { ...quote, lineId: lineRow.id };
    }

    it("an issued revision's content cannot change, even with raw SQL", async () => {
      const { revisionId } = await issuedQuote();
      const db = getDb();
      await expect(
        db.$executeRawUnsafe(
          `UPDATE "quote_revision" SET "totalDzd" = 1, "subtotalDzd" = 1, "taxDzd" = 0 WHERE id = $1`,
          revisionId,
        ),
      ).rejects.toThrow(/immutable snapshot/);
      await expect(
        db.$executeRawUnsafe(
          `UPDATE "quote_revision" SET "snapshot" = '{}'::jsonb WHERE id = $1`,
          revisionId,
        ),
      ).rejects.toThrow(/immutable snapshot/);
      await expect(
        db.$executeRawUnsafe(
          `UPDATE "quote_revision" SET "notes" = 'changed' WHERE id = $1`,
          revisionId,
        ),
      ).rejects.toThrow(/immutable snapshot/);
      await expect(
        db.$executeRawUnsafe(`DELETE FROM "quote_revision" WHERE id = $1`, revisionId),
      ).rejects.toThrow(/cannot be deleted/);
    });

    it("lines of an issued revision cannot be inserted, edited or removed", async () => {
      const { revisionId, lineId } = await issuedQuote();
      const db = getDb();
      await expect(
        db.$executeRawUnsafe(`UPDATE "quote_line" SET "unitPrice" = 1 WHERE id = $1`, lineId),
      ).rejects.toThrow(/immutable/);
      await expect(
        db.$executeRawUnsafe(`DELETE FROM "quote_line" WHERE id = $1`, lineId),
      ).rejects.toThrow(/immutable/);
      await expect(
        db.$executeRawUnsafe(
          `INSERT INTO "quote_line" ("id","revisionId","position","kind","description","quantity","unitPrice")
           VALUES (gen_random_uuid()::text, $1, 99, 'other', 'sneaky', 1, 1)`,
          revisionId,
        ),
      ).rejects.toThrow(/immutable/);
    });

    it("status moves only along allowed paths, and decisions are final", async () => {
      const { revisionId } = await issuedQuote();
      const db = getDb();
      await expect(
        db.$executeRawUnsafe(
          `UPDATE "quote_revision" SET "status" = 'draft' WHERE id = $1`,
          revisionId,
        ),
      ).rejects.toThrow(/invalid quote revision status change/);
      await decideRevision(sales.ctx, revisionId, { decision: "accepted" });
      await expect(
        db.$executeRawUnsafe(
          `UPDATE "quote_revision" SET "status" = 'rejected', "decidedAt" = now() WHERE id = $1`,
          revisionId,
        ),
      ).rejects.toThrow(/invalid quote revision status change/);
      await expect(
        db.$executeRawUnsafe(
          `UPDATE "quote_revision" SET "decisionNote" = 'edited' WHERE id = $1`,
          revisionId,
        ),
      ).rejects.toThrow(/decision is final/);
    });

    it("a draft cannot skip issuing, and a quote keeps its number and lead", async () => {
      const { revisionId, id } = await newQuote();
      const db = getDb();
      await expect(
        db.$executeRawUnsafe(
          `UPDATE "quote_revision" SET "status" = 'accepted', "decidedAt" = now() WHERE id = $1`,
          revisionId,
        ),
      ).rejects.toThrow();
      await expect(
        db.$executeRawUnsafe(`UPDATE "quote" SET "number" = 'Q-0000-0000' WHERE id = $1`, id),
      ).rejects.toThrow(/immutable/);
    });

    it("rejects impossible values with CHECK constraints", async () => {
      const { revisionId } = await newQuote();
      const db = getDb();
      const insert = (qty: string, price: string, discount = "0") =>
        db.$executeRawUnsafe(
          `INSERT INTO "quote_line" ("id","revisionId","position","kind","description","quantity","unitPrice","discountPct")
           VALUES (gen_random_uuid()::text, $1, 1, 'other', 'x', ${qty}, ${price}, ${discount})`,
          revisionId,
        );
      await expect(insert("0", "1")).rejects.toThrow();
      await expect(insert("1", "-1")).rejects.toThrow();
      await expect(insert("1", "1", "101")).rejects.toThrow();
      await expect(
        db.$executeRawUnsafe(
          `UPDATE "quote_revision" SET "totalDzd" = 5 WHERE id = $1`,
          revisionId,
        ),
      ).rejects.toThrow(/total_adds_up/);
    });

    it("allows only one draft and one accepted revision per quote", async () => {
      const { id } = await newQuote();
      const db = getDb();
      await expect(
        db.$executeRawUnsafe(
          `INSERT INTO "quote_revision" ("id","quoteId","number","status","updatedAt") VALUES (gen_random_uuid()::text, $1, 2, 'draft', now())`,
          id,
        ),
      ).rejects.toThrow();
    });
  });
});
