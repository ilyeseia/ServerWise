import { z } from "zod";

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** Money / quantity / percent travel as plain decimal strings, never floats. */
const quantity = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,3})?$/, "invalid_quantity");
const money = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "invalid_amount");
const percent = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "invalid_percent")
  .refine((value) => Number(value) <= 100, "invalid_percent");

export const LINE_KINDS = ["hardware", "labor", "service", "other"] as const;

export const lineInput = z.object({
  kind: z.enum(LINE_KINDS),
  description: z.string().trim().min(1, "required").max(300),
  quantity,
  unitPrice: money,
  discountPct: z.preprocess(blankToUndefined, percent.default("0")),
  taxRatePct: z.preprocess(blankToUndefined, percent.default("0")),
  /** Ignored for lines tied to a price observation: the cost then comes from that observation. */
  unitCost: z.preprocess(blankToUndefined, money.optional()),
  productId: z.preprocess(blankToUndefined, z.uuid().optional()),
  offerId: z.preprocess(blankToUndefined, z.uuid().optional()),
});
export type LineInput = z.input<typeof lineInput>;
export type ParsedLine = z.output<typeof lineInput>;

export const MAX_LINES = 100;

export const saveDraftInput = z.object({
  notes: z.preprocess(blankToUndefined, z.string().trim().max(2000).optional()),
  lines: z.array(lineInput).max(MAX_LINES),
});
export type SaveDraftInput = z.input<typeof saveDraftInput>;

export const createQuoteInput = z.object({
  leadId: z.uuid(),
  title: z.string().trim().min(1, "required").max(200),
});
export type CreateQuoteInput = z.input<typeof createQuoteInput>;

export const decideInput = z.object({
  decision: z.enum(["accepted", "rejected"]),
  note: z.preprocess(blankToUndefined, z.string().trim().max(500).optional()),
});
export type DecideInput = z.input<typeof decideInput>;
