import { z } from "zod";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "./rules";

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const optionalText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

const optionalDate = z.preprocess(blankToUndefined, z.coerce.date().optional());
const requiredDate = z.coerce.date();

const optionalId = z.preprocess(blankToUndefined, z.string().trim().min(1).max(64).optional());

/** Money travels as an exact decimal string with at most two decimals. */
const optionalMoney = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,2})?$/, "invalid_amount")
    .optional(),
);

export const ASSET_KINDS = [
  "server",
  "nas",
  "workstation",
  "network_device",
  "ups",
  "software_service",
  "subscription",
  "other",
] as const;
export const ASSET_STATUSES = ["active", "faulty", "retired"] as const;

export const assetInput = z
  .object({
    customerId: z.uuid(),
    projectId: optionalId,
    productId: optionalId,
    kind: z.enum(ASSET_KINDS),
    name: z.string().trim().min(1, "required").max(160),
    brand: optionalText(80),
    model: optionalText(120),
    serialNumber: optionalText(120),
    os: optionalText(120),
    version: optionalText(60),
    location: optionalText(200),
    installedAt: optionalDate,
    warrantyUntil: optionalDate,
    renewsAt: optionalDate,
    status: z.enum(ASSET_STATUSES).default("active"),
    /** Where the credentials are kept (never the credentials themselves). */
    credentialsRef: optionalText(300),
    notes: optionalText(1000),
  })
  .refine((v) => !v.installedAt || !v.warrantyUntil || v.warrantyUntil >= v.installedAt, {
    path: ["warrantyUntil"],
    message: "date_order",
  });
export type AssetInput = z.input<typeof assetInput>;

export const contractInput = z
  .object({
    customerId: z.uuid(),
    title: z.string().trim().min(1, "required").max(200),
    startsAt: requiredDate,
    endsAt: requiredDate,
    monthlyFeeDzd: optionalMoney,
    notes: optionalText(1000),
    assetIds: z.array(z.uuid()).max(200).default([]),
  })
  .refine((v) => v.endsAt >= v.startsAt, { path: ["endsAt"], message: "date_order" });
export type ContractInput = z.input<typeof contractInput>;

export const scheduleInput = z.object({
  title: z.string().trim().min(1, "required").max(200),
  intervalMonths: z.coerce.number().int().min(1).max(60),
  anchorDate: requiredDate,
  assigneeId: optionalId,
  active: z.boolean().default(true),
});
export type ScheduleInput = z.input<typeof scheduleInput>;

export const serviceReportInput = z.object({
  scheduleId: optionalId,
  ticketId: optionalId,
  assetId: optionalId,
  /** Needed only when the report is not tied to a schedule, a ticket or an asset. */
  customerId: z.preprocess(blankToUndefined, z.uuid().optional()),
  performedAt: requiredDate,
  summary: z.string().trim().min(1, "required").max(2000),
  partsReplaced: optionalText(1000),
});
export type ServiceReportInput = z.input<typeof serviceReportInput>;

export const ticketInput = z.object({
  customerId: z.uuid(),
  assetId: optionalId,
  title: z.string().trim().min(1, "required").max(200),
  description: optionalText(4000),
  priority: z.enum(TICKET_PRIORITIES).default("normal"),
  assigneeId: optionalId,
});
export type TicketInput = z.input<typeof ticketInput>;

export const ticketUpdateInput = z.object({
  assetId: optionalId,
  title: z.string().trim().min(1, "required").max(200),
  description: optionalText(4000),
  priority: z.enum(TICKET_PRIORITIES),
  assigneeId: optionalId,
});
export type TicketUpdateInput = z.input<typeof ticketUpdateInput>;

export const ticketStatusInput = z.object({
  to: z.enum(TICKET_STATUSES),
  resolution: optionalText(2000),
});
export type TicketStatusInput = z.input<typeof ticketStatusInput>;

export const commentInput = z.string().trim().min(1, "required").max(2000);
