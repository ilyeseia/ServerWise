import { z } from "zod";

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const optionalText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

/** Only web links: no javascript:, data:, file: ... Stored links are shown to staff as hyperlinks. */
const webUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === "https:" || protocol === "http:";
    } catch {
      return false;
    }
  }, "invalid_url");

const optionalUrl = z.preprocess(blankToUndefined, webUrl.optional());

const optionalInt = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === "" || v === null ? undefined : typeof v === "string" ? Number(v) : v),
    z.number().int().min(min).max(max).optional(),
  );

const optionalDecimal = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === "" || v === null ? undefined : typeof v === "string" ? Number(v) : v),
    z.number().finite().min(min).max(max).optional(),
  );

/** Form selects send "", "true" or "false": unknown / yes / no. */
const triState = z.preprocess(
  (v) => (v === "true" ? true : v === "false" ? false : v === "" || v === null ? undefined : v),
  z.boolean().optional(),
);

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(blankToUndefined, z.enum(values).optional());

export const PRODUCT_CATEGORIES = [
  "mini_pc",
  "refurbished_desktop",
  "nas",
  "workstation",
  "server",
] as const;
export const GPU_CLASSES = ["none", "integrated", "dedicated"] as const;
export const NOISE_CLASSES = ["silent", "quiet", "normal", "loud"] as const;
export const SUPPLIER_KINDS = [
  "retailer",
  "marketplace_seller",
  "manufacturer",
  "importer",
  "individual",
] as const;
export const OFFER_CONDITIONS = ["new", "refurbished", "used"] as const;
export const AVAILABILITIES = [
  "in_stock",
  "limited",
  "on_order",
  "out_of_stock",
  "unknown",
] as const;

export const productInput = z
  .object({
    category: z.enum(PRODUCT_CATEGORIES),
    brand: z.string().trim().min(1).max(80),
    model: z.string().trim().min(1).max(120),
    cpuModel: optionalText(120),
    cpuCores: optionalInt(1, 512),
    cpuBenchmark: optionalInt(1, 1_000_000),
    cpuBenchmarkSource: optionalUrl,
    ramGb: optionalInt(1, 4096),
    ramMaxGb: optionalInt(1, 4096),
    storageSlots: optionalInt(0, 64),
    storageMaxTb: optionalDecimal(0, 10_000),
    lanPorts: optionalInt(0, 64),
    lanSpeedMbps: optionalInt(1, 400_000),
    hasWifi: triState,
    gpuClass: optionalEnum(GPU_CLASSES),
    noiseClass: optionalEnum(NOISE_CLASSES),
    idleWatts: optionalInt(0, 5000),
    maxWatts: optionalInt(1, 10_000),
    ecc: triState,
    specsSource: optionalUrl,
    notes: optionalText(2000),
  })
  .refine((v) => v.ramGb === undefined || v.ramMaxGb === undefined || v.ramMaxGb >= v.ramGb, {
    path: ["ramMaxGb"],
    message: "ram_max",
  })
  .refine(
    (v) => v.idleWatts === undefined || v.maxWatts === undefined || v.maxWatts >= v.idleWatts,
    {
      path: ["maxWatts"],
      message: "power_range",
    },
  );
export type ProductInput = z.input<typeof productInput>;
export type ProductData = z.output<typeof productInput>;

export const supplierInput = z.object({
  name: z.string().trim().min(2).max(160),
  kind: z.enum(SUPPLIER_KINDS),
  wilayaCode: optionalInt(1, 58),
  phone: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .regex(/^\+?\(?[0-9][0-9 ().-]{5,19}$/, "invalid_phone")
      .optional(),
  ),
  url: optionalUrl,
  notes: optionalText(1000),
});
export type SupplierInput = z.input<typeof supplierInput>;

const dateTime = z.preprocess(
  (v) => (typeof v === "string" || typeof v === "number" ? new Date(v) : v),
  z.date().refine((d) => !Number.isNaN(d.getTime())),
);

export const offerInput = z
  .object({
    productId: z.uuid(),
    supplierId: z.uuid(),
    priceDzd: z.preprocess(
      (v) => (typeof v === "string" ? Number(v) : v),
      z.number().finite().positive().max(1_000_000_000),
    ),
    condition: z.enum(OFFER_CONDITIONS),
    availability: z.enum(AVAILABILITIES).default("unknown"),
    warrantyMonths: optionalInt(0, 120),
    locationWilayaCode: optionalInt(1, 58),
    sourceUrl: optionalUrl,
    quoteReference: optionalText(160),
    checkedAt: dateTime,
    notes: optionalText(1000),
  })
  .refine((v) => Boolean(v.sourceUrl) || Boolean(v.quoteReference), {
    path: ["sourceUrl"],
    message: "evidence_required",
  });
export type OfferInput = z.input<typeof offerInput>;
export type OfferData = z.output<typeof offerInput>;
