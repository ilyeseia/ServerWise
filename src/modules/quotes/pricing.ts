import { z } from "zod";
import { auditData } from "@/server/audit/tx";
import { assertCan, type Actor } from "@/server/authz/guard";
import { getDb } from "@/server/db/client";
import type { CrmContext } from "@/modules/crm/context";

/**
 * Pricing configuration, owned by the business (never invented by the software). Nothing here has
 * a legal or commercial default: tax rates are entered by the owner, and a missing markup or
 * margin means "not configured", not zero.
 */
export const PRICING_KEY = "pricing";

const percent = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "invalid_percent")
  .refine((value) => Number(value) <= 100, "invalid_percent");

const markup = z
  .string()
  .trim()
  .regex(/^\d{1,4}(\.\d{1,2})?$/, "invalid_percent")
  .refine((value) => Number(value) <= 1000, "invalid_percent");

const money = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "invalid_amount");

export const pricingSchema = z
  .object({
    /** How long an issued quotation stays valid. */
    validityDays: z.number().int().min(1).max(365),
    /** The tax rates (percent) staff may apply to a line; "0" is always allowed. */
    taxRatesPct: z.array(percent).max(6),
    /** Pre-selected rate for new lines; must be one of taxRatesPct. */
    defaultTaxRatePct: percent.nullable(),
    /** Markup over the supplier price used to suggest a selling price; null = not configured. */
    markupPct: markup.nullable(),
    /** Issuing below this margin needs the owner; null = no rule. */
    minMarginPct: percent.nullable(),
    /** Suggested hourly labour rate in DZD; null = not configured. */
    laborRateDzdPerHour: money.nullable(),
  })
  .superRefine((value, ctx) => {
    const normalized = value.taxRatesPct.map((rate) => Number(rate));
    if (new Set(normalized).size !== normalized.length) {
      ctx.addIssue({ code: "custom", path: ["taxRatesPct"], message: "duplicate_rate" });
    }
    if (
      value.defaultTaxRatePct !== null &&
      !normalized.includes(Number(value.defaultTaxRatePct)) &&
      Number(value.defaultTaxRatePct) !== 0
    ) {
      ctx.addIssue({ code: "custom", path: ["defaultTaxRatePct"], message: "not_in_list" });
    }
  });
export type PricingSettings = z.infer<typeof pricingSchema>;

export const DEFAULT_PRICING: PricingSettings = {
  validityDays: 15,
  taxRatesPct: [],
  defaultTaxRatePct: null,
  markupPct: null,
  minMarginPct: null,
  laborRateDzdPerHour: null,
};

/** True when a rate may be used on a line: zero is always fine, anything else must be listed. */
export function isAllowedTaxRate(pricing: PricingSettings, rate: string): boolean {
  const value = Number(rate);
  return value === 0 || pricing.taxRatesPct.some((allowed) => Number(allowed) === value);
}

type Reader = Pick<ReturnType<typeof getDb>, "appSetting">;

export async function readPricing(db: Reader = getDb()): Promise<PricingSettings> {
  const row = await db.appSetting.findUnique({ where: { key: PRICING_KEY } });
  const parsed = pricingSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : DEFAULT_PRICING;
}

/** Anyone who can read settings can see how quotations are priced. */
export async function getPricing(ctx: CrmContext): Promise<PricingSettings> {
  assertCan(ctx.actor, "settings:read");
  return readPricing();
}

/** Stores the pricing configuration and audits it in the same transaction (owner only). */
export async function updatePricing(ctx: CrmContext, input: unknown): Promise<PricingSettings> {
  assertCan(ctx.actor, "settings:update");
  const actor: Actor = ctx.actor;
  const next = pricingSchema.parse(input);
  const db = getDb();

  await db.$transaction(async (tx) => {
    const before = await readPricing(tx);
    const changed = (Object.keys(next) as (keyof PricingSettings)[]).filter(
      (key) => JSON.stringify(next[key]) !== JSON.stringify(before[key]),
    );
    await tx.appSetting.upsert({
      where: { key: PRICING_KEY },
      create: { key: PRICING_KEY, value: next },
      update: { value: next },
    });
    await tx.auditLog.create({
      data: auditData(actor, "settings.updated", "setting", PRICING_KEY, { changed }, ctx.client),
    });
  });
  return next;
}
