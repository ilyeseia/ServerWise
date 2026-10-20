import { z } from "zod";

/** Empty / whitespace-only form fields mean "not provided". */
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const optionalText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

/** Phone numbers as typed in Algeria: +213 555 12 34 56, 0555 12 34 56, 036 12 34 56… */
const phone = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .regex(/^\+?\(?[0-9][0-9 ().-]{5,19}$/, "invalid_phone")
    .optional(),
);

const email = z.preprocess(
  blankToUndefined,
  z.string().trim().toLowerCase().pipe(z.email().max(254)).optional(),
);

const wilayaCode = z.preprocess(
  (v) => (v === "" || v === null ? undefined : typeof v === "string" ? Number(v) : v),
  z.number().int().min(1).max(58).optional(),
);

const money = z.preprocess(
  (v) => (v === "" || v === null ? undefined : typeof v === "string" ? Number(v) : v),
  z.number().finite().min(0).max(1_000_000_000).optional(),
);

export const customerInput = z.object({
  type: z.enum(["individual", "business"]),
  name: z.string().trim().min(2).max(200),
  legalName: optionalText(200),
  taxId: optionalText(40),
  phone,
  email,
  wilayaCode,
  address: optionalText(300),
  preferredLanguage: z.enum(["ar", "fr"]).default("ar"),
  notes: optionalText(2000),
});
export type CustomerInput = z.input<typeof customerInput>;
export type CustomerData = z.output<typeof customerInput>;

export const contactInput = z.object({
  name: z.string().trim().min(2).max(200),
  jobTitle: optionalText(120),
  phone,
  email,
  isPrimary: z.boolean().default(false),
});
export type ContactInput = z.input<typeof contactInput>;

export const LEAD_SOURCES = [
  "referral",
  "phone",
  "whatsapp",
  "facebook",
  "ouedkniss",
  "walk_in",
  "website",
  "other",
] as const;

export const leadInput = z
  .object({
    customerId: z.uuid(),
    title: z.string().trim().min(2).max(200),
    source: z.enum(LEAD_SOURCES).default("other"),
    budgetMinDzd: money,
    budgetMaxDzd: money,
    ownerId: z.preprocess(blankToUndefined, z.string().min(1).max(64).optional()),
    notes: optionalText(2000),
  })
  .refine(
    (v) =>
      v.budgetMinDzd === undefined ||
      v.budgetMaxDzd === undefined ||
      v.budgetMaxDzd >= v.budgetMinDzd,
    { path: ["budgetMaxDzd"], message: "budget_range" },
  );
export type LeadInput = z.input<typeof leadInput>;

export const leadUpdateInput = z
  .object({
    title: z.string().trim().min(2).max(200),
    source: z.enum(LEAD_SOURCES),
    budgetMinDzd: money,
    budgetMaxDzd: money,
    ownerId: z.preprocess(blankToUndefined, z.string().min(1).max(64).optional()),
    notes: optionalText(2000),
  })
  .refine(
    (v) =>
      v.budgetMinDzd === undefined ||
      v.budgetMaxDzd === undefined ||
      v.budgetMaxDzd >= v.budgetMinDzd,
    { path: ["budgetMaxDzd"], message: "budget_range" },
  );
export type LeadUpdateInput = z.input<typeof leadUpdateInput>;

const dateTime = z.preprocess(
  (v) => (typeof v === "string" || typeof v === "number" ? new Date(v) : v),
  z.date().refine((d) => !Number.isNaN(d.getTime())),
);

export const followUpInput = z.object({
  customerId: z.uuid(),
  leadId: z.preprocess(blankToUndefined, z.uuid().optional()),
  title: z.string().trim().min(2).max(200),
  dueAt: dateTime,
  assignedToId: z.preprocess(blankToUndefined, z.string().min(1).max(64).optional()),
  notes: optionalText(1000),
});
export type FollowUpInput = z.input<typeof followUpInput>;

export const COMMUNICATION_CHANNELS = [
  "call",
  "whatsapp",
  "sms",
  "email",
  "visit",
  "other",
] as const;

export const communicationInput = z.object({
  customerId: z.uuid(),
  leadId: z.preprocess(blankToUndefined, z.uuid().optional()),
  channel: z.enum(COMMUNICATION_CHANNELS),
  direction: z.enum(["inbound", "outbound"]),
  occurredAt: dateTime,
  summary: z.string().trim().min(2).max(2000),
});
export type CommunicationInput = z.input<typeof communicationInput>;

export const pageInput = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
