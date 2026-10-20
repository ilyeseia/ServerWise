import type {
  AdvisorOutput,
  Candidate,
  ExclusionReason,
  FactorId,
  FactorResult,
  FactorStatus,
  Needs,
  NoiseClass,
  ScoredProduct,
} from "./types";

/**
 * Deterministic hardware scoring. Pure functions: same inputs, same output, no I/O, no AI.
 *
 * How a recommendation is built (and therefore how it is explained):
 *  1. Each factor (performance, RAM, ...) is judged on a 0..1 scale from facts about the product.
 *  2. A factor with no data is "unknown" - it is NOT guessed. Unknown factors do not move the score
 *     but lower the `confidence` (the share of applicable weight that had data).
 *  3. score      = weighted mean of the judged factors, 0..100
 *     adjusted   = score x (0.7 + 0.3 x confidence)   <- the ranking key, so thin data cannot win
 *  4. Hard limits (over budget, memory or storage that can never be enough, no usable price)
 *     exclude a product from the ranking; excluded products are still shown, with the reason.
 *
 * Weights are an engineering judgement of what matters for a small server, listed below so the
 * owner can review and tune them. Bump ENGINE_VERSION whenever scoring behaviour changes: saved
 * recommendations record the version they were produced with.
 */

export const ENGINE_VERSION = 1;

export const DEFAULT_WEIGHTS: Record<FactorId, number> = {
  performance: 20,
  ram: 15,
  storage: 15,
  network: 10,
  noise: 10,
  budget: 10,
  power: 5,
  gpu: 5,
  upgradeability: 5,
  warranty: 5,
};

const NOISE_RANK: Record<NoiseClass, number> = { silent: 0, quiet: 1, normal: 2, loud: 3 };

const round = (v: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

type Judge = Omit<FactorResult, "id" | "weight">;

const unknown = (evidence: Judge["evidence"]): Judge => ({
  score: null,
  status: "unknown",
  evidence,
});
const notApplicable = (): Judge => ({ score: null, status: "not_applicable", evidence: {} });
const verdict = (score: number, evidence: Judge["evidence"], metAt = 1, partialAt = 0.5): Judge => {
  const s = round(clamp01(score));
  const status: FactorStatus = s >= metAt ? "met" : s >= partialAt ? "partial" : "unmet";
  return { score: s, status, evidence };
};

function performance(needs: Needs, c: Candidate): Judge {
  const required = needs.cpuBenchmarkRequired;
  const actual = c.product.cpuBenchmark;
  if (actual === null) return unknown({ required, actual: null });
  const ratio = actual / required;
  return verdict(ratio, { required, actual, ratio: round(ratio) }, 1, 0.7);
}

function ram(needs: Needs, c: Candidate): Judge {
  const required = needs.ramGbRequired;
  const installed = c.product.ramGb;
  const max = c.product.ramMaxGb;
  const evidence = { required, installed, max };
  if (installed === null && max === null) return unknown(evidence);
  if (installed !== null && installed >= required) return { score: 1, status: "met", evidence };
  // Not enough installed: can it be expanded to enough?
  if (max !== null && max >= required)
    return { score: 0.6, status: "partial", evidence: { ...evidence, needsUpgrade: true } };
  if (max !== null) return { score: 0, status: "unmet", evidence };
  // Installed is too small and the upgrade path is unknown.
  return verdict(Math.min(0.5, (installed ?? 0) / required), evidence, 1, 0.3);
}

function storage(needs: Needs, c: Candidate): Judge {
  if (needs.storageRawTbRequired <= 0) return notApplicable();
  const required = needs.storageRawTbRequired;
  const maxTb = c.product.storageMaxTb;
  const slots = c.product.storageSlots;
  const evidence = {
    requiredRawTb: required,
    maxTb,
    requiredSlots: needs.storageSlotsRequired,
    slots,
  };
  if (maxTb === null) return unknown(evidence);
  const capacity = Math.min(1, maxTb / required);
  // Too few drive slots for the redundancy level halves the score; unknown slots are not penalised.
  const slotFactor = slots === null || slots >= needs.storageSlotsRequired ? 1 : 0.5;
  return verdict(capacity * slotFactor, evidence);
}

function network(needs: Needs, c: Candidate): Judge {
  const required = needs.lanSpeedMbpsRequired;
  if (required === null && needs.wifiRequired !== true) return notApplicable();
  const actual = c.product.lanSpeedMbps;
  const evidence = {
    requiredMbps: required,
    actualMbps: actual,
    wifiRequired: needs.wifiRequired,
    hasWifi: c.product.hasWifi,
  };

  let score = 1;
  if (required !== null) {
    if (actual === null) return unknown(evidence);
    score = Math.min(1, actual / required);
  }
  if (needs.wifiRequired === true && c.product.hasWifi === false) score *= 0.7;
  return verdict(score, evidence);
}

function noise(needs: Needs, c: Candidate): Judge {
  const allowed = needs.noiseAllowed;
  if (allowed === null) return notApplicable();
  const actual = c.product.noiseClass;
  const evidence = { allowed, actual };
  if (actual === null) return unknown(evidence);
  const over = NOISE_RANK[actual] - NOISE_RANK[allowed];
  if (over <= 0) return { score: 1, status: "met", evidence };
  if (over === 1) return { score: 0.5, status: "partial", evidence };
  return { score: 0, status: "unmet", evidence };
}

function power(needs: Needs, c: Candidate): Judge {
  const limit = needs.maxWatts;
  if (limit !== null) {
    const actual = c.product.maxWatts;
    const evidence = { limitWatts: limit, maxWatts: actual };
    if (actual === null) return unknown(evidence);
    if (actual <= limit) return { score: 1, status: "met", evidence };
    if (actual <= limit * 1.25) return { score: 0.5, status: "partial", evidence };
    return { score: 0, status: "unmet", evidence };
  }
  // No explicit limit, but it runs 24/7: prefer low idle consumption.
  if (needs.alwaysOn === true) {
    const idle = c.product.idleWatts;
    if (idle === null) return unknown({ idleWatts: null });
    const score = idle <= 10 ? 1 : idle <= 25 ? 0.8 : idle <= 50 ? 0.5 : 0.2;
    return verdict(score, { idleWatts: idle }, 0.8, 0.5);
  }
  return notApplicable();
}

function gpu(needs: Needs, c: Candidate): Judge {
  if (needs.gpuRequired !== true) return notApplicable();
  const actual = c.product.gpuClass;
  const evidence = { gpu: actual };
  if (actual === null) return unknown(evidence);
  if (actual === "dedicated") return { score: 1, status: "met", evidence };
  if (actual === "integrated") return { score: 0.5, status: "partial", evidence };
  return { score: 0, status: "unmet", evidence };
}

function upgradeability(needs: Needs, c: Candidate): Judge {
  const max = c.product.ramMaxGb;
  const required = needs.ramGbRequired;
  if (max === null) return unknown({ ramMaxGb: null, required });
  const ratio = max / required;
  const evidence = { ramMaxGb: max, required, ratio: round(ratio) };
  if (ratio >= 2) return { score: 1, status: "met", evidence };
  if (ratio >= 1) return { score: 0.6, status: "partial", evidence };
  return { score: 0, status: "unmet", evidence };
}

function warranty(c: Candidate): Judge {
  const offer = c.offer;
  if (!offer) return notApplicable();
  const months = offer.warrantyMonths;
  const evidence = { months, condition: offer.condition };
  if (months === null) return unknown(evidence);
  let score: number;
  switch (offer.condition) {
    case "new":
      score = months >= 24 ? 1 : months >= 12 ? 0.8 : months > 0 ? 0.5 : 0.2;
      break;
    case "refurbished":
      score = months >= 12 ? 1 : months >= 6 ? 0.7 : months > 0 ? 0.4 : 0.1;
      break;
    default: // used
      score = months >= 3 ? 0.6 : 0.2;
  }
  return verdict(score, evidence, 0.8, 0.5);
}

function budget(needs: Needs, c: Candidate): Judge {
  if (!c.offer || needs.budgetMaxDzd === null) return notApplicable();
  const price = c.offer.priceDzd;
  const max = needs.budgetMaxDzd;
  const evidence = { priceDzd: price, budgetMaxDzd: max, marginDzd: round(max - price) };
  if (price > max) return { score: 0, status: "unmet", evidence };
  // Within budget: cheaper is better, but never worse than 0.7.
  return { score: round(0.7 + 0.3 * (1 - price / max)), status: "met", evidence };
}

function exclusions(needs: Needs, c: Candidate): ExclusionReason[] {
  const reasons: ExclusionReason[] = [];
  if (!c.offer) reasons.push("no_usable_offer");
  if (c.offer && needs.budgetMaxDzd !== null && c.offer.priceDzd > needs.budgetMaxDzd)
    reasons.push("over_budget");
  const ramMax = c.product.ramMaxGb;
  if (ramMax !== null && ramMax < needs.ramGbRequired) reasons.push("ram_insufficient");
  const storageMax = c.product.storageMaxTb;
  if (
    needs.storageRawTbRequired > 0 &&
    storageMax !== null &&
    storageMax < needs.storageRawTbRequired
  ) {
    reasons.push("storage_insufficient");
  }
  return reasons;
}

export function scoreCandidate(
  needs: Needs,
  candidate: Candidate,
  weights: Record<FactorId, number> = DEFAULT_WEIGHTS,
): ScoredProduct {
  const judged: Record<FactorId, Judge> = {
    performance: performance(needs, candidate),
    ram: ram(needs, candidate),
    storage: storage(needs, candidate),
    network: network(needs, candidate),
    noise: noise(needs, candidate),
    power: power(needs, candidate),
    gpu: gpu(needs, candidate),
    upgradeability: upgradeability(needs, candidate),
    warranty: warranty(candidate),
    budget: budget(needs, candidate),
  };
  const factors: FactorResult[] = (Object.keys(judged) as FactorId[]).map((id) => ({
    id,
    weight: weights[id],
    ...judged[id],
  }));

  let applicableWeight = 0;
  let knownWeight = 0;
  let weighted = 0;
  for (const f of factors) {
    if (f.status === "not_applicable") continue;
    applicableWeight += f.weight;
    if (f.score !== null) {
      knownWeight += f.weight;
      weighted += f.weight * f.score;
    }
  }
  const score = knownWeight > 0 ? (weighted / knownWeight) * 100 : 0;
  const confidence = applicableWeight > 0 ? knownWeight / applicableWeight : 0;

  const { product, offer, unusableOffers } = candidate;
  return {
    productId: product.id,
    brand: product.brand,
    model: product.model,
    category: product.category,
    offer,
    score: round(score, 1),
    confidence: round(confidence),
    adjusted: round(score * (0.7 + 0.3 * confidence), 1),
    factors,
    exclusions: exclusions(needs, candidate),
    unusableOffers,
  };
}

/** Ranking order: adjusted score, then lower price, then name (so results are stable). */
function compare(a: ScoredProduct, b: ScoredProduct): number {
  return (
    b.adjusted - a.adjusted ||
    (a.offer?.priceDzd ?? Number.POSITIVE_INFINITY) -
      (b.offer?.priceDzd ?? Number.POSITIVE_INFINITY) ||
    `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`)
  );
}

export function runAdvisor(
  needs: Needs,
  candidates: Candidate[],
  weights: Record<FactorId, number> = DEFAULT_WEIGHTS,
): AdvisorOutput {
  const scored = candidates.map((c) => scoreCandidate(needs, c, weights));
  return {
    engineVersion: ENGINE_VERSION,
    needs,
    weights,
    ranked: scored.filter((s) => s.exclusions.length === 0).sort(compare),
    excluded: scored
      .filter((s) => s.exclusions.length > 0)
      .sort((a, b) => `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`)),
  };
}
