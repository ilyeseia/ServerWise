import { describe, expect, it } from "vitest";
import { deriveNeeds } from "@/modules/advisor/needs";
import {
  DEFAULT_WEIGHTS,
  ENGINE_VERSION,
  runAdvisor,
  scoreCandidate,
} from "@/modules/advisor/scoring";
import type {
  Candidate,
  FactorId,
  FactorResult,
  Needs,
  OfferInfo,
  ProductSpecs,
} from "@/modules/advisor/types";

const emptySpecs = (id: string, over: Partial<ProductSpecs> = {}): ProductSpecs => ({
  id,
  category: "mini_pc",
  brand: "Brand",
  model: id,
  cpuBenchmark: null,
  cpuModel: null,
  ramGb: null,
  ramMaxGb: null,
  storageSlots: null,
  storageMaxTb: null,
  lanSpeedMbps: null,
  hasWifi: null,
  gpuClass: null,
  noiseClass: null,
  idleWatts: null,
  maxWatts: null,
  ...over,
});

const offer = (priceDzd: number, over: Partial<OfferInfo> = {}): OfferInfo => ({
  id: `offer-${priceDzd}`,
  supplierId: "s1",
  supplierName: "Supplier",
  priceDzd,
  condition: "new",
  warrantyMonths: 24,
  availability: "in_stock",
  checkedAt: "2026-10-18T10:00:00.000Z",
  state: "fresh",
  sourceUrl: "https://example.test/listing",
  quoteReference: null,
  ...over,
});

const candidate = (specs: ProductSpecs, o: OfferInfo | null = offer(90_000)): Candidate => ({
  product: specs,
  offer: o,
  unusableOffers: [],
});

const factor = (result: { factors: FactorResult[] }, id: FactorId) =>
  result.factors.find((f) => f.id === id)!;

/** A realistic small-office NAS request. */
const nasNeeds = (): Needs =>
  deriveNeeds({
    workloads: ["file_storage"],
    concurrentUsers: 3,
    storageTb: 4,
    redundancy: "mirror",
    lanSpeed: "1g",
    noiseLevel: "quiet",
    budgetMaxDzd: 150_000,
    alwaysOn: true,
    maxPowerWatts: 40,
  });

const goodNas = () =>
  emptySpecs("nas-good", {
    category: "nas",
    cpuBenchmark: 5500,
    ramGb: 8,
    ramMaxGb: 32,
    storageSlots: 4,
    storageMaxTb: 40,
    lanSpeedMbps: 2500,
    noiseClass: "quiet",
    idleWatts: 8,
    maxWatts: 30,
  });

describe("needs used by the scenarios", () => {
  it("are what the tests below assume", () => {
    expect(nasNeeds()).toMatchObject({
      ramGbRequired: 8,
      cpuBenchmarkRequired: 2500,
      storageRawTbRequired: 8,
      storageSlotsRequired: 2,
      lanSpeedMbpsRequired: 1000,
      noiseAllowed: "quiet",
      maxWatts: 40,
      budgetMaxDzd: 150_000,
    });
  });
});

describe("scoreCandidate: a product that fits", () => {
  const result = scoreCandidate(nasNeeds(), candidate(goodNas()));

  it("judges every factor with data as met", () => {
    for (const id of [
      "performance",
      "ram",
      "storage",
      "network",
      "noise",
      "power",
      "upgradeability",
      "warranty",
      "budget",
    ] as const) {
      expect(factor(result, id).status, id).toBe("met");
    }
    expect(factor(result, "gpu").status).toBe("not_applicable"); // nobody asked for a GPU
  });

  it("computes the weighted score exactly (golden value)", () => {
    // Applicable weight 95 (everything but gpu). Budget score = 0.7 + 0.3 * (1 - 90000/150000) = 0.82.
    // (20 + 15 + 15 + 10 + 10 + 5 + 5 + 5 + 10 * 0.82) / 95 * 100 = 98.1
    expect(result.score).toBe(98.1);
    expect(factor(result, "budget").score).toBe(0.82);
    expect(result.confidence).toBe(1);
    expect(result.adjusted).toBe(98.1);
    expect(result.exclusions).toEqual([]);
  });

  it("explains each verdict with the numbers behind it", () => {
    expect(factor(result, "performance").evidence).toMatchObject({ required: 2500, actual: 5500 });
    expect(factor(result, "ram").evidence).toMatchObject({ required: 8, installed: 8, max: 32 });
    expect(factor(result, "storage").evidence).toMatchObject({
      requiredRawTb: 8,
      maxTb: 40,
      requiredSlots: 2,
      slots: 4,
    });
    expect(factor(result, "budget").evidence).toMatchObject({
      priceDzd: 90_000,
      budgetMaxDzd: 150_000,
      marginDzd: 60_000,
    });
  });

  it("carries the offer that backs the recommendation", () => {
    expect(result.offer).toMatchObject({
      priceDzd: 90_000,
      supplierName: "Supplier",
      state: "fresh",
    });
  });
});

describe("scoreCandidate: missing data is never guessed", () => {
  it("marks unspecified factors unknown, leaves the score to what is known, and lowers confidence", () => {
    const sparse = scoreCandidate(nasNeeds(), candidate(emptySpecs("sparse", { ramGb: 8 })));
    expect(factor(sparse, "performance").status).toBe("unknown");
    expect(factor(sparse, "storage").status).toBe("unknown");
    expect(factor(sparse, "ram")).toMatchObject({ status: "met", score: 1 });

    expect(sparse.confidence).toBeLessThan(1);
    expect(sparse.confidence).toBeGreaterThan(0);
    // The raw score only reflects known factors, but ranking uses the confidence-adjusted value.
    expect(sparse.adjusted).toBeLessThan(sparse.score);
  });

  it("ranks a fully documented product above a thin one even when the thin one scores higher raw", () => {
    const thin = emptySpecs("thin", { cpuBenchmark: 99_999, ramGb: 64, ramMaxGb: 128 });
    const documented = goodNas();
    const out = runAdvisor(nasNeeds(), [candidate(thin), candidate(documented)]);
    const byId = Object.fromEntries(out.ranked.map((r) => [r.productId, r]));
    expect(byId["thin"]!.score).toBeGreaterThanOrEqual(byId["nas-good"]!.score - 5);
    expect(out.ranked[0]!.productId).toBe("nas-good");
  });

  it("scores 0 with 0 confidence when nothing is known", () => {
    const blank = scoreCandidate(deriveNeeds({}), candidate(emptySpecs("blank"), null));
    expect(blank.score).toBe(0);
    expect(blank.confidence).toBe(0);
    expect(blank.adjusted).toBe(0);
  });
});

describe("exclusions (hard limits)", () => {
  it("excludes a product with no usable price, and still lists it", () => {
    const out = runAdvisor(nasNeeds(), [candidate(goodNas(), null)]);
    expect(out.ranked).toHaveLength(0);
    expect(out.excluded[0]!.exclusions).toEqual(["no_usable_offer"]);
  });

  it("excludes a product over budget, and keeps the gap in the evidence", () => {
    const out = runAdvisor(nasNeeds(), [candidate(goodNas(), offer(200_000))]);
    expect(out.ranked).toHaveLength(0);
    expect(out.excluded[0]!.exclusions).toContain("over_budget");
    expect(factor(out.excluded[0]!, "budget")).toMatchObject({
      status: "unmet",
      evidence: { marginDzd: -50_000 },
    });
  });

  it("accepts a price exactly at the budget", () => {
    const out = runAdvisor(nasNeeds(), [candidate(goodNas(), offer(150_000))]);
    expect(out.ranked).toHaveLength(1);
    expect(factor(out.ranked[0]!, "budget").score).toBe(0.7);
  });

  it("excludes memory that can never be enough", () => {
    const needs = deriveNeeds({ workloads: ["containers"], containerCount: 20 }); // 16 GB
    const small = emptySpecs("small", { ramGb: 4, ramMaxGb: 8 });
    expect(runAdvisor(needs, [candidate(small)]).excluded[0]!.exclusions).toContain(
      "ram_insufficient",
    );
  });

  it("does not exclude on memory when the upgrade path is simply unknown", () => {
    const needs = deriveNeeds({ workloads: ["containers"], containerCount: 20 });
    const out = runAdvisor(needs, [candidate(emptySpecs("maybe", { ramGb: 8 }))]);
    expect(out.ranked).toHaveLength(1);
    expect(factor(out.ranked[0]!, "ram").status).not.toBe("met");
  });

  it("excludes storage that can never be enough", () => {
    const tiny = emptySpecs("tiny", { storageMaxTb: 4, storageSlots: 2 }); // needs 8 TB raw
    expect(runAdvisor(nasNeeds(), [candidate(tiny)]).excluded[0]!.exclusions).toContain(
      "storage_insufficient",
    );
  });

  it("can report several reasons at once", () => {
    const bad = emptySpecs("bad", { ramMaxGb: 4, storageMaxTb: 1 });
    const out = runAdvisor(nasNeeds(), [candidate(bad, offer(500_000))]);
    expect(out.excluded[0]!.exclusions.sort()).toEqual([
      "over_budget",
      "ram_insufficient",
      "storage_insufficient",
    ]);
  });
});

describe("individual factors", () => {
  const needs = (a: Parameters<typeof deriveNeeds>[0]) => deriveNeeds(a);

  it("performance: ratio of benchmark to requirement, capped at 1", () => {
    const n = needs({ workloads: ["file_storage"] }); // 2500
    expect(
      factor(scoreCandidate(n, candidate(emptySpecs("a", { cpuBenchmark: 2500 }))), "performance"),
    ).toMatchObject({ status: "met", score: 1 });
    expect(
      factor(
        scoreCandidate(n, candidate(emptySpecs("a", { cpuBenchmark: 100_000 }))),
        "performance",
      ).score,
    ).toBe(1);
    expect(
      factor(scoreCandidate(n, candidate(emptySpecs("a", { cpuBenchmark: 1875 }))), "performance"),
    ).toMatchObject({ status: "partial", score: 0.75 });
    expect(
      factor(scoreCandidate(n, candidate(emptySpecs("a", { cpuBenchmark: 1000 }))), "performance"),
    ).toMatchObject({ status: "unmet", score: 0.4 });
  });

  it("ram: enough, upgradeable, or not", () => {
    const n = needs({ workloads: ["containers"], containerCount: 20 }); // 16 GB
    expect(
      factor(scoreCandidate(n, candidate(emptySpecs("a", { ramGb: 16 }))), "ram"),
    ).toMatchObject({ status: "met", score: 1 });
    expect(
      factor(scoreCandidate(n, candidate(emptySpecs("a", { ramGb: 8, ramMaxGb: 64 }))), "ram"),
    ).toMatchObject({ status: "partial", score: 0.6 });
    expect(
      factor(scoreCandidate(n, candidate(emptySpecs("a", { ramGb: 8, ramMaxGb: 8 }))), "ram"),
    ).toMatchObject({ status: "unmet", score: 0 });
  });

  it("storage: capacity ratio, halved when there are too few drive slots", () => {
    const n = needs({ storageTb: 4, redundancy: "mirror" }); // 8 TB raw, 2 slots
    expect(
      factor(
        scoreCandidate(n, candidate(emptySpecs("a", { storageMaxTb: 8, storageSlots: 2 }))),
        "storage",
      ).score,
    ).toBe(1);
    expect(
      factor(
        scoreCandidate(n, candidate(emptySpecs("a", { storageMaxTb: 16, storageSlots: 1 }))),
        "storage",
      ),
    ).toMatchObject({ score: 0.5, status: "partial" });
    expect(
      factor(scoreCandidate(n, candidate(emptySpecs("a", { storageMaxTb: 16 }))), "storage").score,
    ).toBe(1); // unknown slots: no penalty
    expect(
      factor(scoreCandidate(needs({ storageTb: 0 }), candidate(goodNas())), "storage").status,
    ).toBe("not_applicable");
  });

  it("network: speed ratio, and a Wi-Fi penalty when it is required but missing", () => {
    const n = needs({ lanSpeed: "10g" });
    expect(
      factor(scoreCandidate(n, candidate(emptySpecs("a", { lanSpeedMbps: 10_000 }))), "network")
        .score,
    ).toBe(1);
    expect(
      factor(scoreCandidate(n, candidate(emptySpecs("a", { lanSpeedMbps: 2500 }))), "network"),
    ).toMatchObject({ score: 0.25, status: "unmet" });
    const wifi = needs({ lanSpeed: "1g", wifiNeeded: true });
    expect(
      factor(
        scoreCandidate(wifi, candidate(emptySpecs("a", { lanSpeedMbps: 1000, hasWifi: true }))),
        "network",
      ).score,
    ).toBe(1);
    expect(
      factor(
        scoreCandidate(wifi, candidate(emptySpecs("a", { lanSpeedMbps: 1000, hasWifi: false }))),
        "network",
      ).score,
    ).toBe(0.7);
    expect(factor(scoreCandidate(needs({}), candidate(goodNas())), "network").status).toBe(
      "not_applicable",
    );
  });

  it("noise: at or below the wanted level is met, one step above is partial, more is unmet", () => {
    const n = needs({ noiseLevel: "quiet" });
    const score = (noiseClass: ProductSpecs["noiseClass"]) =>
      factor(scoreCandidate(n, candidate(emptySpecs("a", { noiseClass }))), "noise");
    expect(score("silent")).toMatchObject({ status: "met", score: 1 });
    expect(score("quiet")).toMatchObject({ status: "met", score: 1 });
    expect(score("normal")).toMatchObject({ status: "partial", score: 0.5 });
    expect(score("loud")).toMatchObject({ status: "unmet", score: 0 });
    expect(score(null).status).toBe("unknown");
    expect(
      factor(
        scoreCandidate(
          needs({ noiseLevel: "silent" }),
          candidate(emptySpecs("a", { noiseClass: "quiet" })),
        ),
        "noise",
      ).score,
    ).toBe(0.5);
  });

  it("power: explicit limit, otherwise idle draw for an always-on server", () => {
    const limit = needs({ alwaysOn: true, maxPowerWatts: 40 });
    const watts = (maxWatts: number | null) =>
      factor(scoreCandidate(limit, candidate(emptySpecs("a", { maxWatts }))), "power");
    expect(watts(40)).toMatchObject({ status: "met", score: 1 });
    expect(watts(50)).toMatchObject({ status: "partial", score: 0.5 });
    expect(watts(51)).toMatchObject({ status: "unmet", score: 0 });
    expect(watts(null).status).toBe("unknown");

    const always = needs({ alwaysOn: true });
    const idle = (idleWatts: number) =>
      factor(scoreCandidate(always, candidate(emptySpecs("a", { idleWatts }))), "power").score;
    expect([idle(8), idle(20), idle(40), idle(90)]).toEqual([1, 0.8, 0.5, 0.2]);
    expect(
      factor(scoreCandidate(needs({ alwaysOn: false }), candidate(goodNas())), "power").status,
    ).toBe("not_applicable");
  });

  it("gpu: only when requested", () => {
    const n = needs({ gpuNeeded: true });
    const gpu = (gpuClass: ProductSpecs["gpuClass"]) =>
      factor(scoreCandidate(n, candidate(emptySpecs("a", { gpuClass }))), "gpu");
    expect(gpu("dedicated")).toMatchObject({ status: "met", score: 1 });
    expect(gpu("integrated")).toMatchObject({ status: "partial", score: 0.5 });
    expect(gpu("none")).toMatchObject({ status: "unmet", score: 0 });
    expect(gpu(null).status).toBe("unknown");
    expect(
      factor(scoreCandidate(needs({ gpuNeeded: false }), candidate(goodNas())), "gpu").status,
    ).toBe("not_applicable");
  });

  it("upgradeability: headroom above the required memory", () => {
    const n = needs({ workloads: ["file_storage"] }); // 8 GB
    const up = (ramMaxGb: number | null) =>
      factor(scoreCandidate(n, candidate(emptySpecs("a", { ramMaxGb }))), "upgradeability");
    expect(up(16)).toMatchObject({ status: "met", score: 1 });
    expect(up(8)).toMatchObject({ status: "partial", score: 0.6 });
    expect(up(4)).toMatchObject({ status: "unmet", score: 0 });
    expect(up(null).status).toBe("unknown");
  });

  it("warranty: depends on the condition of the item", () => {
    const n = deriveNeeds({});
    const w = (condition: OfferInfo["condition"], warrantyMonths: number | null) =>
      factor(
        scoreCandidate(n, candidate(emptySpecs("a"), offer(1000, { condition, warrantyMonths }))),
        "warranty",
      );
    expect(w("new", 24).score).toBe(1);
    expect(w("new", 12).score).toBe(0.8);
    expect(w("new", 0).score).toBe(0.2);
    expect(w("refurbished", 12).score).toBe(1);
    expect(w("refurbished", 6).score).toBe(0.7);
    expect(w("used", 3).score).toBe(0.6);
    expect(w("used", 0).score).toBe(0.2);
    expect(w("new", null).status).toBe("unknown");
  });

  it("budget: cheaper is better but never below 0.7 while within budget; skipped without a budget", () => {
    const n = deriveNeeds({ budgetMaxDzd: 100_000 });
    const b = (price: number) =>
      factor(scoreCandidate(n, candidate(emptySpecs("a"), offer(price))), "budget").score;
    expect(b(1)).toBeGreaterThan(0.99);
    expect(b(50_000)).toBe(0.85);
    expect(b(100_000)).toBe(0.7);
    expect(factor(scoreCandidate(deriveNeeds({}), candidate(goodNas())), "budget").status).toBe(
      "not_applicable",
    );
  });
});

describe("runAdvisor: ranking", () => {
  it("orders by adjusted score, then lower price, then name", () => {
    const a = emptySpecs("a", { brand: "Alpha", model: "A" });
    const b = emptySpecs("b", { brand: "Beta", model: "B" });
    const c = emptySpecs("c", { brand: "Alpha", model: "Z" });
    const needs = deriveNeeds({});
    // Identical (empty) specs -> identical scores; price decides, then name.
    const out = runAdvisor(needs, [
      candidate(c, offer(300)),
      candidate(b, offer(100)),
      candidate(a, offer(100)),
    ]);
    expect(out.ranked.map((r) => r.productId)).toEqual(["a", "b", "c"]);
  });

  it("puts stronger products first", () => {
    const strong = goodNas();
    const weak = emptySpecs("weak", {
      cpuBenchmark: 1000,
      ramGb: 4,
      ramMaxGb: 4 + 8,
      storageMaxTb: 12,
      storageSlots: 2,
      lanSpeedMbps: 1000,
      noiseClass: "loud",
      maxWatts: 90,
    });
    const out = runAdvisor(nasNeeds(), [candidate(weak), candidate(strong)]);
    expect(out.ranked.map((r) => r.productId)).toEqual(["nas-good", "weak"]);
    expect(out.ranked[0]!.adjusted).toBeGreaterThan(out.ranked[1]!.adjusted);
  });

  it("records the engine version, the needs and the weights used", () => {
    const out = runAdvisor(nasNeeds(), [candidate(goodNas())]);
    expect(out.engineVersion).toBe(ENGINE_VERSION);
    expect(out.needs.ramGbRequired).toBe(8);
    expect(out.weights).toEqual(DEFAULT_WEIGHTS);
  });

  it("custom weights change the outcome", () => {
    const quietButSlow = emptySpecs("quiet", { cpuBenchmark: 1200, noiseClass: "silent" });
    const fastButLoud = emptySpecs("fast", { cpuBenchmark: 9000, noiseClass: "loud" });
    const needs = deriveNeeds({ workloads: ["file_storage"], noiseLevel: "silent" });
    const performanceFirst = runAdvisor(needs, [candidate(quietButSlow), candidate(fastButLoud)], {
      ...DEFAULT_WEIGHTS,
      performance: 90,
      noise: 1,
    });
    const noiseFirst = runAdvisor(needs, [candidate(quietButSlow), candidate(fastButLoud)], {
      ...DEFAULT_WEIGHTS,
      performance: 1,
      noise: 90,
    });
    expect(performanceFirst.ranked[0]!.productId).toBe("fast");
    expect(noiseFirst.ranked[0]!.productId).toBe("quiet");
  });

  it("does not mutate its inputs and is deterministic", () => {
    const needs = nasNeeds();
    const candidates = [candidate(goodNas()), candidate(emptySpecs("x", { ramGb: 16 }))];
    const before = structuredClone({ needs, candidates });
    const first = runAdvisor(needs, candidates);
    const second = runAdvisor(needs, candidates);
    expect(first).toEqual(second);
    expect({ needs, candidates }).toEqual(before);
  });

  it("handles an empty catalog", () => {
    expect(runAdvisor(nasNeeds(), [])).toMatchObject({ ranked: [], excluded: [] });
  });
});

describe("invariants over many random products", () => {
  // Small deterministic PRNG so failures are reproducible.
  const rng = (seed: number) => () =>
    (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const maybe = <T>(r: () => number, make: () => T): T | null => (r() < 0.3 ? null : make());

  it("scores stay in range and confidence/adjusted are consistent", () => {
    const r = rng(42);
    const answersPool = [
      {},
      {
        workloads: ["file_storage"],
        storageTb: 6,
        redundancy: "raid5",
        lanSpeed: "2_5g",
        noiseLevel: "silent",
        budgetMaxDzd: 200_000,
      },
      {
        workloads: ["containers", "media", "surveillance"],
        containerCount: 15,
        cameraCount: 8,
        gpuNeeded: true,
        alwaysOn: true,
        maxPowerWatts: 35,
        wifiNeeded: true,
      },
      {
        workloads: ["virtualization", "dev_test"],
        vmCount: 6,
        growth2y: "high",
        cpuPriority: "performance",
      },
    ];
    for (let i = 0; i < 400; i++) {
      const needs = deriveNeeds(answersPool[i % answersPool.length] as never);
      const specs = emptySpecs(`p${i}`, {
        cpuBenchmark: maybe(r, () => Math.floor(r() * 30_000) + 500),
        ramGb: maybe(r, () => [4, 8, 16, 32, 64][Math.floor(r() * 5)]!),
        ramMaxGb: maybe(r, () => [8, 16, 32, 64, 128][Math.floor(r() * 5)]!),
        storageSlots: maybe(r, () => Math.floor(r() * 8)),
        storageMaxTb: maybe(r, () => Math.floor(r() * 100)),
        lanSpeedMbps: maybe(r, () => [1000, 2500, 10_000][Math.floor(r() * 3)]!),
        hasWifi: maybe(r, () => r() < 0.5),
        gpuClass: maybe(
          r,
          () => (["none", "integrated", "dedicated"] as const)[Math.floor(r() * 3)]!,
        ),
        noiseClass: maybe(
          r,
          () => (["silent", "quiet", "normal", "loud"] as const)[Math.floor(r() * 4)]!,
        ),
        idleWatts: maybe(r, () => Math.floor(r() * 100)),
        maxWatts: maybe(r, () => Math.floor(r() * 300) + 5),
      });
      const o =
        r() < 0.15
          ? null
          : offer(Math.floor(r() * 400_000) + 1000, {
              warrantyMonths: maybe(r, () => Math.floor(r() * 36)),
            });
      const s = scoreCandidate(needs, candidate(specs, o));

      expect(s.score, `p${i}`).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
      expect(s.confidence).toBeGreaterThanOrEqual(0);
      expect(s.confidence).toBeLessThanOrEqual(1);
      expect(s.adjusted).toBeLessThanOrEqual(s.score);
      expect(s.adjusted).toBeGreaterThanOrEqual(s.score * 0.7 - 0.06);
      for (const f of s.factors) {
        if (f.score !== null) {
          expect(f.score).toBeGreaterThanOrEqual(0);
          expect(f.score).toBeLessThanOrEqual(1);
        }
        expect(
          f.status === "unknown" || f.status === "not_applicable"
            ? f.score === null
            : f.score !== null,
        ).toBe(true);
      }
      // No usable offer always excludes; having one never does by itself.
      expect(s.exclusions.includes("no_usable_offer")).toBe(o === null);
    }
  });

  it("is monotonic in price: a cheaper offer never scores lower", () => {
    const needs = deriveNeeds({ budgetMaxDzd: 300_000, workloads: ["file_storage"] });
    let previous = Infinity;
    for (const price of [20_000, 60_000, 120_000, 200_000, 300_000]) {
      const s = scoreCandidate(needs, candidate(goodNas(), offer(price)));
      expect(s.score).toBeLessThanOrEqual(previous);
      previous = s.score;
    }
  });

  it("is monotonic in capability: more RAM never lowers the RAM factor", () => {
    const needs = deriveNeeds({ workloads: ["containers"], containerCount: 20 });
    let previous = -1;
    for (const ramGb of [2, 4, 8, 12, 16, 32]) {
      const f = factor(scoreCandidate(needs, candidate(emptySpecs("a", { ramGb }))), "ram");
      expect(f.score ?? 0).toBeGreaterThanOrEqual(previous);
      previous = f.score ?? 0;
    }
  });
});
