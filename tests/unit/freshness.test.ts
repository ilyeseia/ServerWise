import { describe, expect, it } from "vitest";
import {
  DEFAULT_FRESHNESS,
  STRICT_USAGE,
  ageInDays,
  isUsable,
  offerState,
  type OfferState,
} from "@/modules/catalog/freshness";

const NOW = new Date("2026-10-20T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const verified = (d: number) => ({
  verificationStatus: "verified" as const,
  checkedAt: daysAgo(d),
});

describe("ageInDays", () => {
  it("counts whole days and never goes negative", () => {
    expect(ageInDays(daysAgo(0), NOW)).toBe(0);
    expect(ageInDays(new Date(NOW.getTime() - 23 * 3600_000), NOW)).toBe(0);
    expect(ageInDays(daysAgo(1), NOW)).toBe(1);
    expect(ageInDays(daysAgo(30), NOW)).toBe(30);
    expect(ageInDays(new Date(NOW.getTime() + 3 * 86_400_000), NOW)).toBe(0); // clock skew
  });
});

describe("offerState (defaults: fresh <= 14 days, expired > 60 days)", () => {
  it("verified prices age from fresh to stale to expired at the documented boundaries", () => {
    expect(DEFAULT_FRESHNESS).toEqual({ freshDays: 14, expiryDays: 60 });
    expect(offerState(verified(0), NOW)).toBe("fresh");
    expect(offerState(verified(14), NOW)).toBe("fresh");
    expect(offerState(verified(15), NOW)).toBe("stale");
    expect(offerState(verified(60), NOW)).toBe("stale");
    expect(offerState(verified(61), NOW)).toBe("expired");
    expect(offerState(verified(400), NOW)).toBe("expired");
  });

  it("an unverified price is unverified however recent it is", () => {
    for (const days of [0, 3, 200]) {
      expect(offerState({ verificationStatus: "unverified", checkedAt: daysAgo(days) }, NOW)).toBe(
        "unverified",
      );
    }
  });

  it("a rejected price is rejected, whatever its age", () => {
    for (const days of [0, 30, 500]) {
      expect(offerState({ verificationStatus: "rejected", checkedAt: daysAgo(days) }, NOW)).toBe(
        "rejected",
      );
    }
  });

  it("honours a custom policy", () => {
    const policy = { freshDays: 3, expiryDays: 10 };
    expect(offerState(verified(3), NOW, policy)).toBe("fresh");
    expect(offerState(verified(4), NOW, policy)).toBe("stale");
    expect(offerState(verified(11), NOW, policy)).toBe("expired");
  });
});

describe("isUsable", () => {
  const states: OfferState[] = ["fresh", "stale", "expired", "unverified", "rejected"];

  it("by default only fresh prices are used", () => {
    expect(states.filter((s) => isUsable(s, STRICT_USAGE))).toEqual(["fresh"]);
    expect(states.filter((s) => isUsable(s))).toEqual(["fresh"]);
  });

  it("stale and unverified prices are used only when asked", () => {
    expect(
      states.filter((s) => isUsable(s, { includeStale: true, includeUnverified: false })),
    ).toEqual(["fresh", "stale"]);
    expect(
      states.filter((s) => isUsable(s, { includeStale: false, includeUnverified: true })),
    ).toEqual(["fresh", "unverified"]);
    expect(
      states.filter((s) => isUsable(s, { includeStale: true, includeUnverified: true })),
    ).toEqual(["fresh", "stale", "unverified"]);
  });

  it("expired and rejected prices are never used, whatever the options", () => {
    const everything = { includeStale: true, includeUnverified: true };
    expect(isUsable("expired", everything)).toBe(false);
    expect(isUsable("rejected", everything)).toBe(false);
  });
});
