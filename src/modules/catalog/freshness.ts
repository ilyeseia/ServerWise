/**
 * How trustworthy a recorded price is *today*. A price is an observation made on a date; the
 * older it is, the less it can be relied on. Rules (also in docs/PRODUCT_REQUIREMENTS.md FR-3/4):
 *
 *   rejected    a person confirmed the price is wrong          -> never used
 *   unverified  recorded but nobody has confirmed the source    -> used only when asked
 *   fresh       verified and checked within `freshDays`          -> used
 *   stale       verified, older than `freshDays`, within expiry  -> used only when asked
 *   expired     verified but older than `expiryDays`             -> never used
 */

export type OfferState = "fresh" | "stale" | "expired" | "unverified" | "rejected";

export interface FreshnessPolicy {
  /** A verified price this young (days) is "fresh". */
  freshDays: number;
  /** A verified price older than this (days) is "expired" and never used. */
  expiryDays: number;
}

/** Local second-hand and retail prices move quickly; two weeks is a deliberately short default. */
export const DEFAULT_FRESHNESS: FreshnessPolicy = { freshDays: 14, expiryDays: 60 };

const DAY_MS = 86_400_000;

/** Whole days between the observation and now (never negative: a future date counts as today). */
export function ageInDays(checkedAt: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - checkedAt.getTime()) / DAY_MS));
}

export interface OfferLike {
  verificationStatus: "unverified" | "verified" | "rejected";
  checkedAt: Date;
}

export function offerState(
  offer: OfferLike,
  now: Date = new Date(),
  policy: FreshnessPolicy = DEFAULT_FRESHNESS,
): OfferState {
  if (offer.verificationStatus === "rejected") return "rejected";
  if (offer.verificationStatus === "unverified") return "unverified";
  const age = ageInDays(offer.checkedAt, now);
  if (age <= policy.freshDays) return "fresh";
  if (age <= policy.expiryDays) return "stale";
  return "expired";
}

export interface UsageOptions {
  /** Also use verified prices older than `freshDays` (but not expired ones). */
  includeStale: boolean;
  /** Also use prices nobody has verified yet. */
  includeUnverified: boolean;
}

export const STRICT_USAGE: UsageOptions = { includeStale: false, includeUnverified: false };

export function isUsable(state: OfferState, options: UsageOptions = STRICT_USAGE): boolean {
  switch (state) {
    case "fresh":
      return true;
    case "stale":
      return options.includeStale;
    case "unverified":
      return options.includeUnverified;
    case "expired":
    case "rejected":
      return false;
  }
}
