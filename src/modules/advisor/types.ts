import type { OfferState } from "@/modules/catalog/freshness";

export type NoiseClass = "silent" | "quiet" | "normal" | "loud";
export type GpuClass = "none" | "integrated" | "dedicated";

/** The facts about a hardware model that scoring can use. `null` always means "unknown". */
export interface ProductSpecs {
  id: string;
  category: string;
  brand: string;
  model: string;
  cpuBenchmark: number | null;
  cpuModel: string | null;
  ramGb: number | null;
  ramMaxGb: number | null;
  storageSlots: number | null;
  storageMaxTb: number | null;
  lanSpeedMbps: number | null;
  hasWifi: boolean | null;
  gpuClass: GpuClass | null;
  noiseClass: NoiseClass | null;
  idleWatts: number | null;
  maxWatts: number | null;
}

/** The price that backs a recommendation. */
export interface OfferInfo {
  id: string;
  supplierId: string;
  supplierName: string;
  priceDzd: number;
  condition: "new" | "refurbished" | "used";
  warrantyMonths: number | null;
  availability: string;
  checkedAt: string; // ISO
  state: OfferState;
  sourceUrl: string | null;
  quoteReference: string | null;
}

export interface Candidate {
  product: ProductSpecs;
  /** Best usable offer, if any. */
  offer: OfferInfo | null;
  /** Offers that exist but were not usable under the chosen options (for the explanation). */
  unusableOffers: { id: string; state: OfferState }[];
}

export type StorageRedundancy = "none" | "mirror" | "raid5" | "raid6";

/** What the customer needs, derived from the questionnaire. Every figure can be traced. */
export interface Needs {
  ramGbRequired: number;
  cpuBenchmarkRequired: number;
  storageTb: number; // usable capacity asked for
  storageRawTbRequired: number; // including redundancy overhead and growth
  storageSlotsRequired: number;
  redundancy: StorageRedundancy;
  lanSpeedMbpsRequired: number | null;
  wifiRequired: boolean | null;
  gpuRequired: boolean | null;
  noiseAllowed: NoiseClass | null;
  maxWatts: number | null;
  alwaysOn: boolean | null;
  budgetMinDzd: number | null;
  budgetMaxDzd: number | null;
  growthFactor: number;
  /** How the figures above were derived, for display ("why 16 GB?"). */
  assumptions: Assumption[];
}

export interface Assumption {
  /** Translation key under Advisor.assumption.* */
  id: string;
  params: Record<string, number | string>;
}

export type FactorId =
  | "performance"
  | "ram"
  | "storage"
  | "network"
  | "noise"
  | "power"
  | "gpu"
  | "upgradeability"
  | "warranty"
  | "budget";

export type FactorStatus = "met" | "partial" | "unmet" | "unknown" | "not_applicable";

export interface FactorResult {
  id: FactorId;
  weight: number;
  /** 0..1, or null when the factor could not be judged (unknown / not applicable). */
  score: number | null;
  status: FactorStatus;
  /** The raw numbers behind the verdict: required, actual, and so on. */
  evidence: Record<string, number | string | boolean | null>;
}

export type ExclusionReason =
  "no_usable_offer" | "over_budget" | "ram_insufficient" | "storage_insufficient";

export interface ScoredProduct {
  productId: string;
  brand: string;
  model: string;
  category: string;
  offer: OfferInfo | null;
  /** 0..100 over the factors that could be judged. */
  score: number;
  /** Share of the applicable weight that had data (0..1). */
  confidence: number;
  /** score x (0.7 + 0.3 x confidence): what ranking uses, so thin data cannot win on a lucky score. */
  adjusted: number;
  factors: FactorResult[];
  exclusions: ExclusionReason[];
  unusableOffers: { id: string; state: OfferState }[];
}

export interface AdvisorOutput {
  engineVersion: number;
  needs: Needs;
  weights: Record<FactorId, number>;
  ranked: ScoredProduct[];
  excluded: ScoredProduct[];
}
