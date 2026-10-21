import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getRecommendation,
  listRecommendations,
  runAdvisorForLead,
} from "@/modules/advisor/service";
import { decideOffer, recordOffer } from "@/modules/catalog/offers";
import {
  compareProducts,
  createProduct,
  getProduct,
  listProducts,
  setProductActive,
  updateProduct,
} from "@/modules/catalog/products";
import type { OfferInput, ProductInput } from "@/modules/catalog/schemas";
import {
  createSupplier,
  listSuppliers,
  setSupplierActive,
  updateSupplier,
} from "@/modules/catalog/suppliers";
import { createCustomer } from "@/modules/crm/customers";
import { changeLeadStatus, createLead } from "@/modules/crm/leads";
import { saveRequirements } from "@/modules/questionnaire/service";
import { ForbiddenError, UnauthorizedError } from "@/server/authz/guard";
import { getDb } from "@/server/db/client";
import {
  deleteCustomers,
  deleteCatalog,
  createStaff,
  auditCount,
  unique,
  type TestStaff,
} from "./crm-helpers";
import { deleteTestUsers } from "./helpers";

let owner: TestStaff;
let sales: TestStaff;
let technician: TestStaff;
let viewer: TestStaff;
const productIds: string[] = [];
const supplierIds: string[] = [];
const customerIds: string[] = [];

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const anonymous = { actor: undefined };

const newProduct = async (over: Partial<ProductInput> = {}) => {
  const product = await createProduct(sales.ctx, {
    category: "nas",
    brand: unique("Brand"),
    model: "Model X",
    ...over,
  } as ProductInput);
  productIds.push(product.id);
  return product;
};

const newSupplier = async (name = unique("Supplier")) => {
  const supplier = await createSupplier(sales.ctx, { name, kind: "retailer" });
  supplierIds.push(supplier.id);
  return supplier;
};

const offerInput = (
  productId: string,
  supplierId: string,
  over: Partial<OfferInput> = {},
): OfferInput => ({
  productId,
  supplierId,
  priceDzd: 90_000,
  condition: "new",
  warrantyMonths: 24,
  sourceUrl: "https://example.test/listing/1",
  checkedAt: daysAgo(1),
  ...over,
});

/** Records a price and has the owner verify it. */
async function verifiedOffer(
  productId: string,
  supplierId: string,
  over: Partial<OfferInput> = {},
) {
  const offer = await recordOffer(sales.ctx, offerInput(productId, supplierId, over));
  await decideOffer(owner.ctx, offer.id, "verified");
  return offer;
}

describe.skipIf(!process.env.DATABASE_URL)("catalog, suppliers and advisor (integration)", () => {
  beforeAll(async () => {
    [owner, sales, technician, viewer] = await Promise.all([
      createStaff("owner"),
      createStaff("sales"),
      createStaff("technician"),
      createStaff("viewer"),
    ]);
  });

  afterAll(async () => {
    await deleteCustomers(customerIds);
    await deleteCatalog(productIds, supplierIds);
    await deleteTestUsers([owner, sales, technician, viewer].map((s) => s.user));
    await getDb().$disconnect();
  });

  // ---------------------------------------------------------------------------------------
  describe("authorization", () => {
    it("every operation rejects anonymous callers", async () => {
      const product = await newProduct();
      const supplier = await newSupplier();
      const offer = await recordOffer(sales.ctx, offerInput(product.id, supplier.id));
      const calls: Record<string, () => Promise<unknown>> = {
        listProducts: () => listProducts(anonymous),
        getProduct: () => getProduct(anonymous, product.id),
        compareProducts: () => compareProducts(anonymous, [product.id]),
        createProduct: () => createProduct(anonymous, { category: "nas", brand: "X", model: "Y" }),
        updateProduct: () =>
          updateProduct(anonymous, product.id, { category: "nas", brand: "X", model: "Y" }),
        setProductActive: () => setProductActive(anonymous, product.id, false),
        listSuppliers: () => listSuppliers(anonymous),
        createSupplier: () => createSupplier(anonymous, { name: "Nobody", kind: "retailer" }),
        updateSupplier: () =>
          updateSupplier(anonymous, supplier.id, { name: "Nobody", kind: "retailer" }),
        setSupplierActive: () => setSupplierActive(anonymous, supplier.id, false),
        recordOffer: () => recordOffer(anonymous, offerInput(product.id, supplier.id)),
        decideOffer: () => decideOffer(anonymous, offer.id, "verified"),
        runAdvisor: () => runAdvisorForLead(anonymous, "x"),
        listRecommendations: () => listRecommendations(anonymous, "x"),
        getRecommendation: () => getRecommendation(anonymous, "x"),
      };
      for (const [name, call] of Object.entries(calls)) {
        await expect(call(), name).rejects.toBeInstanceOf(UnauthorizedError);
      }
    });

    it("viewers cannot read or write the catalog", async () => {
      const product = await newProduct();
      await expect(listProducts(viewer.ctx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getProduct(viewer.ctx, product.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listSuppliers(viewer.ctx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        createProduct(viewer.ctx, { category: "nas", brand: "Blocked", model: "Viewer" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("sales and technicians can maintain the catalog, but only the owner verifies prices", async () => {
      for (const staff of [sales, technician]) {
        const product = await createProduct(staff.ctx, {
          category: "mini_pc",
          brand: unique("Staff"),
          model: "M",
        });
        productIds.push(product.id);
        const supplier = await createSupplier(staff.ctx, {
          name: unique("Staff supplier"),
          kind: "individual",
        });
        supplierIds.push(supplier.id);
        const offer = await recordOffer(staff.ctx, offerInput(product.id, supplier.id));
        await expect(decideOffer(staff.ctx, offer.id, "verified")).rejects.toBeInstanceOf(
          ForbiddenError,
        );
        expect(
          (await getDb().supplierOffer.findUniqueOrThrow({ where: { id: offer.id } }))
            .verificationStatus,
        ).toBe("unverified");
        await expect(decideOffer(owner.ctx, offer.id, "verified")).resolves.toBeTruthy();
      }
    });

    it("running the advisor needs CRM write access; reading its results needs only read access", async () => {
      const customer = await createCustomer(sales.ctx, {
        type: "individual",
        name: unique("Cust"),
      });
      customerIds.push(customer.id);
      const lead = await createLead(sales.ctx, {
        customerId: customer.id,
        title: "Advisor access",
      });
      await saveRequirements(sales.ctx, lead.id, { concurrentUsers: 2 }, { complete: false });

      await expect(runAdvisorForLead(technician.ctx, lead.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(runAdvisorForLead(viewer.ctx, lead.id)).rejects.toBeInstanceOf(ForbiddenError);

      const run = await runAdvisorForLead(sales.ctx, lead.id);
      await expect(listRecommendations(technician.ctx, lead.id)).resolves.toHaveLength(1);
      await expect(getRecommendation(technician.ctx, run.id)).resolves.toBeTruthy();
      await expect(listRecommendations(viewer.ctx, lead.id)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("products", () => {
    it("stores unknown specs as null and reads form-style tri-state values", async () => {
      const product = await newProduct({
        cpuBenchmark: "5500",
        ramGb: "8",
        hasWifi: "false",
        ecc: "",
        gpuClass: "",
        storageMaxTb: "16.5",
      } as unknown as Partial<ProductInput>);
      expect(product).toMatchObject({
        cpuBenchmark: 5500,
        ramGb: 8,
        hasWifi: false,
        ecc: null,
        gpuClass: null,
        noiseClass: null,
        idleWatts: null,
      });
      expect(product.storageMaxTb?.toString()).toBe("16.5");
      expect(await auditCount("product.created", product.id)).toBe(1);
    });

    it("rejects inconsistent or unsafe input before touching the database", async () => {
      // Other test files run in parallel on the same database: count only what this test could add.
      const mine = { model: "Input", brand: { in: ["Bad", "  ", ""] } };
      const before = await getDb().product.count({ where: mine });
      const base = { category: "nas", brand: "Bad", model: "Input" } as const;
      await expect(createProduct(sales.ctx, { ...base, ramGb: 16, ramMaxGb: 8 })).rejects.toThrow();
      await expect(
        createProduct(sales.ctx, { ...base, idleWatts: 50, maxWatts: 20 }),
      ).rejects.toThrow();
      await expect(
        createProduct(sales.ctx, { ...base, specsSource: "javascript:alert(1)" }),
      ).rejects.toThrow();
      await expect(
        createProduct(sales.ctx, { ...base, cpuBenchmarkSource: "ftp://example.test/x" }),
      ).rejects.toThrow();
      await expect(createProduct(sales.ctx, { ...base, brand: "  " })).rejects.toThrow();
      await expect(createProduct(sales.ctx, { ...base, ramGb: -4 })).rejects.toThrow();
      expect(await getDb().product.count({ where: mine })).toBe(before);
    });

    it("the database refuses impossible specs even if the application is bypassed", async () => {
      const db = getDb();
      const base = { category: "nas" as const, brand: "Raw", model: "Insert" };
      await expect(db.product.create({ data: { ...base, ramGb: 0 } })).rejects.toThrow();
      await expect(
        db.product.create({ data: { ...base, ramGb: 16, ramMaxGb: 8 } }),
      ).rejects.toThrow();
      await expect(
        db.product.create({ data: { ...base, idleWatts: 30, maxWatts: 10 } }),
      ).rejects.toThrow();
      await expect(db.product.create({ data: { ...base, model: "   " } })).rejects.toThrow();
    });

    it("updates a product and audits which fields changed", async () => {
      const product = await newProduct({ ramGb: 8 });
      await updateProduct(sales.ctx, product.id, {
        category: "nas",
        brand: product.brand,
        model: product.model,
        ramGb: 16,
        noiseClass: "quiet",
      });
      const updated = await getDb().product.findUniqueOrThrow({ where: { id: product.id } });
      expect(updated).toMatchObject({ ramGb: 16, noiseClass: "quiet" });
      const audit = await getDb().auditLog.findFirstOrThrow({
        where: { action: "product.updated", entityId: product.id },
      });
      expect((audit.metadata as { changed: string[] }).changed).toEqual(
        expect.arrayContaining(["ramGb", "noiseClass"]),
      );
    });

    it("searches, filters, hides deactivated products by default and keeps their history", async () => {
      const token = crypto.randomUUID().slice(0, 8);
      const a = await newProduct({ brand: `ZZ Find ${token} Alpha`, category: "nas" });
      const b = await newProduct({ brand: `ZZ Find ${token} Beta`, category: "mini_pc" });
      expect((await listProducts(sales.ctx, { q: token.toUpperCase() })).total).toBe(2);
      expect(
        (await listProducts(sales.ctx, { q: token, category: "nas" })).items.map((p) => p.id),
      ).toEqual([a.id]);

      await setProductActive(sales.ctx, b.id, false);
      expect((await listProducts(sales.ctx, { q: token })).items.map((p) => p.id)).toEqual([a.id]);
      expect((await listProducts(sales.ctx, { q: token, includeInactive: true })).total).toBe(2);
      expect(await auditCount("product.deactivated", b.id)).toBe(1);
      await setProductActive(sales.ctx, b.id, false); // idempotent
      expect(await auditCount("product.deactivated", b.id)).toBe(1);
    });

    it("reports missing products", async () => {
      await expect(getProduct(sales.ctx, "ghost")).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("compares up to four products in the requested order and ignores unknown ids", async () => {
      const [a, b, c] = [await newProduct(), await newProduct(), await newProduct()];
      const result = await compareProducts(sales.ctx, [c.id, "ghost", a.id, b.id, a.id]);
      expect(result.map((p) => p.id)).toEqual([c.id, a.id, b.id]);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("suppliers", () => {
    it("creates, edits and rejects duplicate names (case-insensitive)", async () => {
      const name = unique("Dupe");
      const supplier = await newSupplier(name);
      await expect(
        createSupplier(sales.ctx, { name: name.toLowerCase(), kind: "retailer" }),
      ).rejects.toMatchObject({ code: "SUPPLIER_EXISTS" });

      const other = await newSupplier();
      await expect(
        updateSupplier(sales.ctx, other.id, { name: name.toUpperCase(), kind: "retailer" }),
      ).rejects.toMatchObject({
        code: "SUPPLIER_EXISTS",
      });
      await updateSupplier(sales.ctx, supplier.id, {
        name,
        kind: "marketplace_seller",
        wilayaCode: "19",
        url: "https://www.ouedkniss.com/store/1",
        phone: "0555 11 22 33",
      });
      expect(
        await getDb().supplier.findUniqueOrThrow({ where: { id: supplier.id } }),
      ).toMatchObject({ kind: "marketplace_seller", wilayaCode: 19 });
    });

    it("rejects bad phone numbers, links and wilaya codes", async () => {
      await expect(
        createSupplier(sales.ctx, { name: "Valid Name", kind: "retailer", phone: "abc" }),
      ).rejects.toThrow();
      await expect(
        createSupplier(sales.ctx, {
          name: "Valid Name",
          kind: "retailer",
          url: "javascript:alert(1)",
        }),
      ).rejects.toThrow();
      await expect(
        createSupplier(sales.ctx, { name: "Valid Name", kind: "retailer", wilayaCode: 99 }),
      ).rejects.toThrow();
    });

    it("an inactive supplier stays in the list on request but takes no new prices", async () => {
      const supplier = await newSupplier();
      const product = await newProduct();
      await setSupplierActive(sales.ctx, supplier.id, false);
      expect((await listSuppliers(sales.ctx)).some((s) => s.id === supplier.id)).toBe(false);
      expect(
        (await listSuppliers(sales.ctx, { includeInactive: true })).some(
          (s) => s.id === supplier.id,
        ),
      ).toBe(true);
      await expect(
        recordOffer(sales.ctx, offerInput(product.id, supplier.id)),
      ).rejects.toMatchObject({ code: "SUPPLIER_INACTIVE" });
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("price observations", () => {
    it("records an unverified price with its evidence and audits it", async () => {
      const product = await newProduct();
      const supplier = await newSupplier();
      const offer = await recordOffer(
        sales.ctx,
        offerInput(product.id, supplier.id, { priceDzd: "89500.50" as unknown as number }),
      );
      expect(offer).toMatchObject({
        verificationStatus: "unverified",
        verifiedAt: null,
        verifiedById: null,
        createdById: sales.actor.id,
      });
      expect(offer.priceDzd.toString()).toBe("89500.5");
      expect(await auditCount("offer.recorded", offer.id)).toBe(1);
    });

    it("never accepts a price without evidence - in code or in the database", async () => {
      const product = await newProduct();
      const supplier = await newSupplier();
      await expect(
        recordOffer(sales.ctx, offerInput(product.id, supplier.id, { sourceUrl: undefined })),
      ).rejects.toThrow();
      await expect(
        recordOffer(
          sales.ctx,
          offerInput(product.id, supplier.id, { sourceUrl: "  ", quoteReference: "  " }),
        ),
      ).rejects.toThrow();
      // A manual quotation reference is acceptable evidence on its own.
      await expect(
        recordOffer(
          sales.ctx,
          offerInput(product.id, supplier.id, {
            sourceUrl: undefined,
            quoteReference: "Quote 2026-114 (phone call)",
          }),
        ),
      ).resolves.toBeTruthy();
      // Bypassing the application does not help.
      await expect(
        getDb().supplierOffer.create({
          data: {
            productId: product.id,
            supplierId: supplier.id,
            priceDzd: 1000,
            condition: "new",
            checkedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it("rejects invalid prices, links, dates and warranties", async () => {
      const product = await newProduct();
      const supplier = await newSupplier();
      const bad = (over: Partial<OfferInput>) =>
        recordOffer(sales.ctx, offerInput(product.id, supplier.id, over));
      await expect(bad({ priceDzd: 0 })).rejects.toThrow();
      await expect(bad({ priceDzd: -5 })).rejects.toThrow();
      await expect(bad({ priceDzd: Number.NaN })).rejects.toThrow();
      await expect(bad({ sourceUrl: "javascript:alert(1)" })).rejects.toThrow();
      await expect(bad({ warrantyMonths: 500 })).rejects.toThrow();
      await expect(bad({ locationWilayaCode: 99 })).rejects.toThrow();
      await expect(
        bad({ checkedAt: new Date(Date.now() + 86_400_000).toISOString() }),
      ).rejects.toMatchObject({ code: "FUTURE_DATE" });
    });

    it("refuses prices for unknown or deactivated products", async () => {
      const supplier = await newSupplier();
      const product = await newProduct();
      await expect(
        recordOffer(sales.ctx, offerInput(crypto.randomUUID(), supplier.id)),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await setProductActive(sales.ctx, product.id, false);
      await expect(
        recordOffer(sales.ctx, offerInput(product.id, supplier.id)),
      ).rejects.toMatchObject({ code: "PRODUCT_INACTIVE" });
    });

    it("an observation is immutable: price, source and date cannot be edited or deleted", async () => {
      const product = await newProduct();
      const supplier = await newSupplier();
      const offer = await recordOffer(sales.ctx, offerInput(product.id, supplier.id));
      const db = getDb();
      for (const data of [
        { priceDzd: 1 },
        { condition: "used" as const },
        { sourceUrl: "https://example.test/other" },
        { checkedAt: new Date() },
        { warrantyMonths: 60 },
        { availability: "in_stock" as const },
      ]) {
        await expect(
          db.supplierOffer.update({ where: { id: offer.id }, data }),
          JSON.stringify(data),
        ).rejects.toThrow(/immutable/);
      }
      await expect(db.supplierOffer.delete({ where: { id: offer.id } })).rejects.toThrow(
        /cannot be deleted/,
      );
      expect(
        (await db.supplierOffer.findUniqueOrThrow({ where: { id: offer.id } })).priceDzd.toString(),
      ).toBe("90000");
    });

    it("verification is a one-time, final decision with who and when", async () => {
      const product = await newProduct();
      const supplier = await newSupplier();
      const offer = await recordOffer(sales.ctx, offerInput(product.id, supplier.id));

      const verified = await decideOffer(owner.ctx, offer.id, "verified");
      expect(verified).toMatchObject({
        verificationStatus: "verified",
        verifiedById: owner.actor.id,
      });
      expect(verified.verifiedAt).not.toBeNull();
      expect(await auditCount("offer.verified", offer.id)).toBe(1);

      await expect(decideOffer(owner.ctx, offer.id, "rejected")).rejects.toMatchObject({
        code: "ALREADY_DECIDED",
      });
      await expect(decideOffer(owner.ctx, offer.id, "verified")).rejects.toMatchObject({
        code: "ALREADY_DECIDED",
      });
      // The database enforces it as well.
      await expect(
        getDb().supplierOffer.update({
          where: { id: offer.id },
          data: { verificationStatus: "rejected" },
        }),
      ).rejects.toThrow(/final/);
      await expect(
        getDb().supplierOffer.update({
          where: { id: offer.id },
          data: { verificationStatus: "unverified", verifiedAt: null },
        }),
      ).rejects.toThrow();
    });

    it("rejecting a price is recorded too", async () => {
      const product = await newProduct();
      const supplier = await newSupplier();
      const offer = await recordOffer(sales.ctx, offerInput(product.id, supplier.id));
      await decideOffer(owner.ctx, offer.id, "rejected");
      expect(await auditCount("offer.rejected", offer.id)).toBe(1);
      await expect(decideOffer(owner.ctx, "ghost", "verified")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(decideOffer(owner.ctx, offer.id, "maybe" as never)).rejects.toMatchObject({
        code: "INVALID_DECISION",
      });
    });

    it("the database refuses a verification state without who/when", async () => {
      const product = await newProduct();
      const supplier = await newSupplier();
      const offer = await recordOffer(sales.ctx, offerInput(product.id, supplier.id));
      await expect(
        getDb().supplierOffer.update({
          where: { id: offer.id },
          data: { verificationStatus: "verified" },
        }),
      ).rejects.toThrow();
      await expect(
        getDb().supplierOffer.update({ where: { id: offer.id }, data: { verifiedAt: new Date() } }),
      ).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("which price is shown (freshness and verification rules)", () => {
    const best = async (productId: string, now?: Date) => {
      const list = await listProducts(
        sales.ctx,
        { q: (await getDb().product.findUniqueOrThrow({ where: { id: productId } })).brand },
        now,
      );
      return list.items.find((p) => p.id === productId)?.bestPrice ?? null;
    };

    it("shows nothing until a price is verified", async () => {
      const product = await newProduct();
      const supplier = await newSupplier();
      const offer = await recordOffer(
        sales.ctx,
        offerInput(product.id, supplier.id, { checkedAt: daysAgo(0) }),
      );
      expect(await best(product.id)).toBeNull();
      await decideOffer(owner.ctx, offer.id, "verified");
      expect(await best(product.id)).toMatchObject({
        priceDzd: 90_000,
        state: "fresh",
        supplierName: supplier.name,
      });
    });

    it("never shows a rejected price", async () => {
      const product = await newProduct();
      const supplier = await newSupplier();
      const offer = await recordOffer(sales.ctx, offerInput(product.id, supplier.id));
      await decideOffer(owner.ctx, offer.id, "rejected");
      expect(await best(product.id)).toBeNull();
    });

    it("stops showing a verified price once it is older than 14 days", async () => {
      const product = await newProduct();
      const supplier = await newSupplier();
      await verifiedOffer(product.id, supplier.id, { checkedAt: daysAgo(13) });
      expect((await best(product.id))?.state).toBe("fresh");
      expect(await best(product.id, new Date(Date.now() + 3 * 86_400_000))).toBeNull(); // 16 days old
    });

    it("a newer observation from the same supplier replaces the older one, even when dearer", async () => {
      const product = await newProduct();
      const supplier = await newSupplier();
      await verifiedOffer(product.id, supplier.id, { priceDzd: 80_000, checkedAt: daysAgo(10) });
      await verifiedOffer(product.id, supplier.id, { priceDzd: 95_000, checkedAt: daysAgo(2) });
      expect((await best(product.id))?.priceDzd).toBe(95_000);

      const detail = await getProduct(sales.ctx, product.id);
      expect(detail.offers.map((o) => [o.priceDzd, o.current])).toEqual([
        ["95000", true],
        ["80000", false],
      ]);
    });

    it("an unverified newer price does not replace an older verified one", async () => {
      const product = await newProduct();
      const supplier = await newSupplier();
      await verifiedOffer(product.id, supplier.id, { priceDzd: 80_000, checkedAt: daysAgo(10) });
      await recordOffer(
        sales.ctx,
        offerInput(product.id, supplier.id, { priceDzd: 10_000, checkedAt: daysAgo(0) }),
      ); // suspiciously cheap
      expect((await best(product.id))?.priceDzd).toBe(80_000);
    });

    it("picks the cheapest supplier among usable prices", async () => {
      const product = await newProduct();
      const [a, b, c] = [await newSupplier(), await newSupplier(), await newSupplier()];
      await verifiedOffer(product.id, a.id, { priceDzd: 120_000 });
      await verifiedOffer(product.id, b.id, { priceDzd: 99_000 });
      await recordOffer(sales.ctx, offerInput(product.id, c.id, { priceDzd: 50_000 })); // unverified: ignored
      expect(await best(product.id)).toMatchObject({ priceDzd: 99_000, supplierName: b.name });
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("hardware advisor", () => {
    const answers = {
      workloads: ["file_storage"],
      concurrentUsers: 3,
      storageTb: 4,
      redundancy: "mirror",
      lanSpeed: "1g",
      noiseLevel: "quiet",
      budgetMaxDzd: 150_000,
      alwaysOn: true,
      maxPowerWatts: 40,
      cpuPriority: "balanced",
      needsRemoteAccess: false,
      needsBackup: false,
      growth2y: "none",
    };

    async function leadWithRequirements(complete = true) {
      const customer = await createCustomer(sales.ctx, {
        type: "individual",
        name: unique("Advice"),
      });
      customerIds.push(customer.id);
      const lead = await createLead(sales.ctx, {
        customerId: customer.id,
        title: "Small office NAS",
      });
      await saveRequirements(sales.ctx, lead.id, answers, { complete });
      return lead;
    }

    /** Only the products this test created matter: the shared catalog may hold others. */
    const mine = <T extends { productId: string }>(items: T[], ids: string[]) =>
      items.filter((i) => ids.includes(i.productId));

    it("needs saved requirements and an open lead", async () => {
      const customer = await createCustomer(sales.ctx, {
        type: "individual",
        name: unique("Advice"),
      });
      customerIds.push(customer.id);
      const lead = await createLead(sales.ctx, {
        customerId: customer.id,
        title: "No answers yet",
      });
      await expect(runAdvisorForLead(sales.ctx, lead.id)).rejects.toMatchObject({
        code: "REQUIREMENTS_MISSING",
      });

      await saveRequirements(sales.ctx, lead.id, answers, { complete: false });
      await changeLeadStatus(sales.ctx, lead.id, "lost", { lostReason: "Went elsewhere" });
      await expect(runAdvisorForLead(sales.ctx, lead.id)).rejects.toMatchObject({
        code: "LEAD_CLOSED",
      });
      await expect(runAdvisorForLead(sales.ctx, crypto.randomUUID())).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("ranks the better machine first, uses only verified fresh prices, and explains every score", async () => {
      const supplier = await newSupplier();
      const good = await newProduct({
        category: "nas",
        cpuBenchmark: 5500,
        ramGb: 8,
        ramMaxGb: 32,
        storageSlots: 4,
        storageMaxTb: 40,
        lanSpeedMbps: 2500,
        noiseClass: "quiet",
        idleWatts: 8,
        maxWatts: 30,
      });
      const weak = await newProduct({
        category: "mini_pc",
        cpuBenchmark: 1800,
        ramGb: 4,
        ramMaxGb: 12,
        storageSlots: 2,
        storageMaxTb: 12,
        lanSpeedMbps: 1000,
        noiseClass: "normal",
        idleWatts: 20,
        maxWatts: 38,
      });
      await verifiedOffer(good.id, supplier.id, { priceDzd: 90_000 });
      await verifiedOffer(weak.id, supplier.id, { priceDzd: 60_000 });
      const lead = await leadWithRequirements();

      const run = await runAdvisorForLead(sales.ctx, lead.id);
      const ids = [good.id, weak.id];
      const ranked = mine(run.output.ranked, ids);
      expect(ranked.map((r) => r.productId)).toEqual([good.id, weak.id]);
      expect(ranked[0]!.adjusted).toBeGreaterThan(ranked[1]!.adjusted);
      expect(ranked[0]!.offer).toMatchObject({
        priceDzd: 90_000,
        supplierName: supplier.name,
        state: "fresh",
      });

      // Every ranked product carries all ten factors, each with weight, status and evidence.
      expect(ranked[0]!.factors.map((f) => f.id).sort()).toEqual([
        "budget",
        "gpu",
        "network",
        "noise",
        "performance",
        "power",
        "ram",
        "storage",
        "upgradeability",
        "warranty",
      ]);
      for (const f of ranked[0]!.factors) {
        expect(f.weight).toBeGreaterThan(0);
        expect(typeof f.status).toBe("string");
      }
      expect(run.output.needs).toMatchObject({
        ramGbRequired: 8,
        storageRawTbRequired: 8,
        budgetMaxDzd: 150_000,
      });
      expect(run.engineVersion).toBe(1);
      expect(await auditCount("recommendation.created", run.id)).toBe(1);
    });

    it("excludes products without a verified fresh price, with the reason - unless asked", async () => {
      const supplier = await newSupplier();
      const unverified = await newProduct({
        cpuBenchmark: 5500,
        ramGb: 8,
        ramMaxGb: 32,
        storageMaxTb: 40,
      });
      const stale = await newProduct({
        cpuBenchmark: 5500,
        ramGb: 8,
        ramMaxGb: 32,
        storageMaxTb: 40,
      });
      const expired = await newProduct({
        cpuBenchmark: 5500,
        ramGb: 8,
        ramMaxGb: 32,
        storageMaxTb: 40,
      });
      const rejected = await newProduct({
        cpuBenchmark: 5500,
        ramGb: 8,
        ramMaxGb: 32,
        storageMaxTb: 40,
      });
      await recordOffer(
        sales.ctx,
        offerInput(unverified.id, supplier.id, { checkedAt: daysAgo(0) }),
      );
      await verifiedOffer(stale.id, supplier.id, { checkedAt: daysAgo(30) });
      await verifiedOffer(expired.id, supplier.id, { checkedAt: daysAgo(90) });
      const bad = await recordOffer(sales.ctx, offerInput(rejected.id, supplier.id));
      await decideOffer(owner.ctx, bad.id, "rejected");
      const ids = [unverified.id, stale.id, expired.id, rejected.id];
      const lead = await leadWithRequirements();

      const strict = await runAdvisorForLead(sales.ctx, lead.id);
      expect(mine(strict.output.ranked, ids)).toHaveLength(0);
      expect(
        mine(strict.output.excluded, ids).every((e) => e.exclusions.includes("no_usable_offer")),
      ).toBe(true);
      const unusable = Object.fromEntries(
        mine(strict.output.excluded, ids).map((e) => [e.productId, e.unusableOffers[0]?.state]),
      );
      expect(unusable).toEqual({
        [unverified.id]: "unverified",
        [stale.id]: "stale",
        [expired.id]: "expired",
        [rejected.id]: "rejected",
      });

      const relaxed = await runAdvisorForLead(sales.ctx, lead.id, {
        includeStale: true,
        includeUnverified: true,
      });
      expect(
        mine(relaxed.output.ranked, ids)
          .map((r) => r.productId)
          .sort(),
      ).toEqual([unverified.id, stale.id].sort());
      // Expired and rejected prices are never used, whatever the options.
      expect(
        mine(relaxed.output.excluded, ids)
          .map((e) => e.productId)
          .sort(),
      ).toEqual([expired.id, rejected.id].sort());
      expect(relaxed.output.ranked.find((r) => r.productId === unverified.id)?.offer?.state).toBe(
        "unverified",
      );
    });

    it("excludes a product over budget and one whose memory can never be enough", async () => {
      const supplier = await newSupplier();
      const dear = await newProduct({
        cpuBenchmark: 9000,
        ramGb: 16,
        ramMaxGb: 64,
        storageMaxTb: 40,
      });
      const tiny = await newProduct({
        cpuBenchmark: 9000,
        ramGb: 4,
        ramMaxGb: 4,
        storageMaxTb: 40,
      });
      await verifiedOffer(dear.id, supplier.id, { priceDzd: 400_000 });
      await verifiedOffer(tiny.id, supplier.id, { priceDzd: 50_000 });
      const lead = await leadWithRequirements();
      const run = await runAdvisorForLead(sales.ctx, lead.id);
      const excluded = Object.fromEntries(
        mine(run.output.excluded, [dear.id, tiny.id]).map((e) => [e.productId, e.exclusions]),
      );
      expect(excluded[dear.id]).toContain("over_budget");
      expect(excluded[tiny.id]).toContain("ram_insufficient");
    });

    it("ignores deactivated products", async () => {
      const supplier = await newSupplier();
      const product = await newProduct({
        cpuBenchmark: 9000,
        ramGb: 16,
        ramMaxGb: 64,
        storageMaxTb: 40,
      });
      await verifiedOffer(product.id, supplier.id, { priceDzd: 70_000 });
      await setProductActive(sales.ctx, product.id, false);
      const lead = await leadWithRequirements();
      const run = await runAdvisorForLead(sales.ctx, lead.id);
      expect(mine([...run.output.ranked, ...run.output.excluded], [product.id])).toHaveLength(0);
    });

    it("saves an immutable snapshot that can be listed and reopened later", async () => {
      const supplier = await newSupplier();
      const product = await newProduct({
        cpuBenchmark: 6000,
        ramGb: 8,
        ramMaxGb: 32,
        storageSlots: 2,
        storageMaxTb: 20,
      });
      await verifiedOffer(product.id, supplier.id, { priceDzd: 85_000 });
      const lead = await leadWithRequirements(false);

      const first = await runAdvisorForLead(sales.ctx, lead.id);
      expect(first.inputs.requirementsStatus).toBe("draft");
      expect(first.inputs.answers).toMatchObject({ storageTb: 4 });
      const second = await runAdvisorForLead(owner.ctx, lead.id, {
        includeStale: true,
        includeUnverified: false,
      });

      const runs = await listRecommendations(technician.ctx, lead.id);
      expect(runs.map((r) => r.id)).toEqual([second.id, first.id]); // newest first
      expect(runs[0]!.options).toEqual({ includeStale: true, includeUnverified: false });
      expect(runs[0]!.createdByName).toBe("Test owner");

      // Prices change afterwards; the saved run still shows what was true at the time.
      await verifiedOffer(product.id, supplier.id, { priceDzd: 120_000 });
      const reopened = await getRecommendation(sales.ctx, first.id);
      expect(reopened.output.ranked.find((r) => r.productId === product.id)?.offer?.priceDzd).toBe(
        85_000,
      );
      expect(reopened.output).toEqual(first.output);

      const db = getDb();
      await expect(
        db.recommendation.update({ where: { id: first.id }, data: { engineVersion: 99 } }),
      ).rejects.toThrow(/immutable snapshot/);
      await expect(db.recommendation.delete({ where: { id: first.id } })).rejects.toThrow(
        /immutable snapshot/,
      );
    });

    it("reports a missing recommendation", async () => {
      await expect(getRecommendation(sales.ctx, crypto.randomUUID())).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });
});
