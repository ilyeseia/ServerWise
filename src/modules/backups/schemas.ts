import { z } from "zod";
import { BACKUP_OUTCOMES, RESTORE_OUTCOMES, TAILNET_OWNERS } from "./rules";

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const optionalText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

const optionalId = z.preprocess(blankToUndefined, z.string().trim().min(1).max(64).optional());

const optionalInt = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === "" || v === null ? undefined : typeof v === "string" ? Number(v) : v),
    z.number().int().min(min).max(max).optional(),
  );

/** Form selects send "", "true" or "false": unknown / yes / no. */
const triState = z.preprocess(
  (v) => (v === "true" ? true : v === "false" ? false : v === "" || v === null ? undefined : v),
  z.boolean().optional(),
);

export const BACKUP_KINDS = [
  "files",
  "database",
  "system_image",
  "configuration",
  "other",
] as const;

export const backupPolicyInput = z.object({
  customerId: z.uuid(),
  assetId: optionalId,
  name: z.string().trim().min(1, "required").max(200),
  kind: z.enum(BACKUP_KINDS),
  frequencyDays: z.coerce.number().int().min(1).max(365),
  retentionDays: optionalInt(1, 3650),
  destination: z.string().trim().min(1, "required").max(300),
  encrypted: triState,
  /** Where the key is kept (never the key). */
  encryptionKeyRef: optionalText(300),
  offsite: triState,
  restoreTestEveryDays: z.coerce.number().int().min(1).max(730).default(90),
  recoveryProcedure: optionalText(4000),
  active: z.boolean().default(true),
  notes: optionalText(1000),
});
export type BackupPolicyInput = z.input<typeof backupPolicyInput>;

export const backupRecordInput = z.object({
  ranAt: z.coerce.date(),
  outcome: z.enum(BACKUP_OUTCOMES),
  sizeMb: optionalInt(0, 100_000_000),
  notes: optionalText(1000),
});
export type BackupRecordInput = z.input<typeof backupRecordInput>;

export const restoreTestInput = z.object({
  testedAt: z.coerce.date(),
  outcome: z.enum(RESTORE_OUTCOMES),
  durationMinutes: optionalInt(0, 100_000),
  notes: optionalText(1000),
});
export type RestoreTestInput = z.input<typeof restoreTestInput>;

export const remotePlanInput = z.object({
  customerId: z.uuid(),
  title: z.string().trim().min(1, "required").max(200),
  tailnetOwner: z.enum(TAILNET_OWNERS).default("customer"),
  devices: optionalText(2000),
  aclNotes: optionalText(4000),
  deviceApproval: z.boolean().default(false),
  keyExpiry: z.boolean().default(false),
  noPublicExposure: z.boolean().default(false),
  noSubnetOrExit: z.boolean().default(false),
  mfa: z.boolean().default(false),
  exceptions: optionalText(2000),
});
export type RemotePlanInput = z.input<typeof remotePlanInput>;
