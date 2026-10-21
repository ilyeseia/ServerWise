import type { ASSET_KINDS, ASSET_STATUSES } from "@/modules/careops/schemas";

/**
 * Plain values shared by the server pages and the client form. They live outside the "use client"
 * module on purpose: a server component that imports a constant from a client module receives a
 * reference, not the value.
 */
export interface AssetFormValues {
  customerId: string;
  kind: (typeof ASSET_KINDS)[number];
  name: string;
  brand: string;
  model: string;
  serialNumber: string;
  os: string;
  version: string;
  location: string;
  installedAt: string;
  warrantyUntil: string;
  renewsAt: string;
  status: (typeof ASSET_STATUSES)[number];
  credentialsRef: string;
  notes: string;
}

export const EMPTY_ASSET: AssetFormValues = {
  customerId: "",
  kind: "server",
  name: "",
  brand: "",
  model: "",
  serialNumber: "",
  os: "",
  version: "",
  location: "",
  installedAt: "",
  warrantyUntil: "",
  renewsAt: "",
  status: "active",
  credentialsRef: "",
  notes: "",
};
