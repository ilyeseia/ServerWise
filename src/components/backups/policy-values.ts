import type { BACKUP_KINDS } from "@/modules/backups/schemas";

/**
 * Plain values shared by the server pages and the client form. They live outside the "use client"
 * module on purpose: a server component that imports a constant from a client module receives a
 * reference, not the value.
 */
export interface PolicyFormValues {
  customerId: string;
  assetId: string;
  name: string;
  kind: (typeof BACKUP_KINDS)[number];
  frequencyDays: string;
  retentionDays: string;
  destination: string;
  /** "" = unknown, "true" / "false". */
  encrypted: string;
  encryptionKeyRef: string;
  offsite: string;
  restoreTestEveryDays: string;
  active: boolean;
  notes: string;
}

export const EMPTY_POLICY: PolicyFormValues = {
  customerId: "",
  assetId: "",
  name: "",
  kind: "files",
  frequencyDays: "1",
  retentionDays: "",
  destination: "",
  encrypted: "",
  encryptionKeyRef: "",
  offsite: "",
  restoreTestEveryDays: "90",
  active: true,
  notes: "",
};

export interface PlanFormValues {
  customerId: string;
  title: string;
  tailnetOwner: "customer" | "provider";
  devices: string;
  aclNotes: string;
  deviceApproval: boolean;
  keyExpiry: boolean;
  noPublicExposure: boolean;
  noSubnetOrExit: boolean;
  mfa: boolean;
  exceptions: string;
}

export const EMPTY_PLAN: PlanFormValues = {
  customerId: "",
  title: "",
  tailnetOwner: "customer",
  devices: "",
  aclNotes: "",
  deviceApproval: true,
  keyExpiry: true,
  noPublicExposure: true,
  noSubnetOrExit: true,
  mfa: true,
  exceptions: "",
};
