import { describe, expect, it } from "vitest";
import { deriveNeeds } from "@/modules/advisor/needs";
import type { Answers } from "@/modules/questionnaire/types";

const needs = (
  answers: Answers,
  budget?: { budgetMinDzd: number | null; budgetMaxDzd: number | null },
) => deriveNeeds(answers, budget);

describe("deriveNeeds: memory", () => {
  it("sizes a small file server", () => {
    // 4 base + 2 file storage = 6 GB -> next standard size
    expect(needs({ workloads: ["file_storage"], concurrentUsers: 3 }).ramGbRequired).toBe(8);
  });

  it("grows with containers, virtual machines and cameras (using the counts given)", () => {
    // 4 + 2 + 10*0.25 = 8.5 -> 16
    expect(needs({ workloads: ["containers"], containerCount: 10 }).ramGbRequired).toBe(16);
    // 4 + 4 + 5*3 = 23 -> 32
    expect(needs({ workloads: ["virtualization"], vmCount: 5 }).ramGbRequired).toBe(32);
    // 4 + 2 + 16*0.5 = 14 -> 16
    expect(needs({ workloads: ["surveillance"], cameraCount: 16 }).ramGbRequired).toBe(16);
  });

  it("adds memory for many concurrent users, capped", () => {
    expect(needs({ workloads: ["file_storage"], concurrentUsers: 10 }).ramGbRequired).toBe(8); // 7 -> 8
    expect(needs({ workloads: ["file_storage"], concurrentUsers: 1000 }).ramGbRequired).toBe(16); // 6 + 8 = 14 -> 16
  });

  it("applies the growth factor", () => {
    const base = needs({
      workloads: ["containers"],
      containerCount: 20,
      growth2y: "none",
    }).ramGbRequired; // 11 -> 16
    const high = needs({ workloads: ["containers"], containerCount: 20, growth2y: "high" }); // 16.5 -> 32
    expect(base).toBe(16);
    expect(high.ramGbRequired).toBe(32);
    expect(high.growthFactor).toBe(1.5);
  });

  it("honours a larger stated amount but never goes below the derived one", () => {
    expect(needs({ workloads: ["file_storage"], ramGb: "32" }).ramGbRequired).toBe(32);
    expect(needs({ workloads: ["virtualization"], vmCount: 5, ramGb: "8" }).ramGbRequired).toBe(32);
    expect(needs({ workloads: ["file_storage"], ramGb: "unsure" }).ramGbRequired).toBe(8);
  });

  it("always needs at least the base system memory", () => {
    expect(needs({}).ramGbRequired).toBe(4);
  });

  it("rounds up to standard module sizes and caps at the largest", () => {
    expect(needs({ workloads: ["virtualization"], vmCount: 100 }).ramGbRequired).toBe(512);
  });
});

describe("deriveNeeds: processor", () => {
  it("has a floor and rounds to 500", () => {
    expect(needs({}).cpuBenchmarkRequired).toBe(2000);
    const samples: Answers[] = [
      { workloads: ["media"] },
      { workloads: ["containers", "dev_test"], containerCount: 7 },
    ];
    for (const a of samples) {
      expect(needs(a).cpuBenchmarkRequired % 500).toBe(0);
    }
  });

  it("scales with the workload", () => {
    const nas = needs({ workloads: ["file_storage"] }).cpuBenchmarkRequired;
    const media = needs({ workloads: ["file_storage", "media"] }).cpuBenchmarkRequired;
    const vms = needs({ workloads: ["virtualization"], vmCount: 6 }).cpuBenchmarkRequired;
    expect(media).toBeGreaterThan(nas);
    expect(vms).toBeGreaterThan(media);
  });

  it("responds to the processor priority", () => {
    const answers = { workloads: ["containers"], containerCount: 10 };
    const low = needs({ ...answers, cpuPriority: "low_power" }).cpuBenchmarkRequired;
    const balanced = needs({ ...answers, cpuPriority: "balanced" }).cpuBenchmarkRequired;
    const high = needs({ ...answers, cpuPriority: "performance" }).cpuBenchmarkRequired;
    expect(low).toBeLessThanOrEqual(balanced);
    expect(high).toBeGreaterThan(balanced);
  });
});

describe("deriveNeeds: unit counts that were not answered", () => {
  it("uses a documented default and says so in the assumptions", () => {
    const n = needs({ workloads: ["surveillance"] });
    const defaulted = n.assumptions.find((a) => a.id === "defaulted");
    expect(defaulted?.params).toEqual({ question: "cameraCount", value: 4 });
  });

  it("does not report a default when the count was given", () => {
    expect(
      needs({ workloads: ["surveillance"], cameraCount: 8 }).assumptions.some(
        (a) => a.id === "defaulted",
      ),
    ).toBe(false);
  });
});

describe("deriveNeeds: storage", () => {
  it("needs nothing when no storage is asked for", () => {
    const n = needs({ storageTb: 0 });
    expect(n.storageRawTbRequired).toBe(0);
    expect(n.storageSlotsRequired).toBe(0);
  });

  it("adds redundancy overhead and the minimum number of drive slots", () => {
    expect(needs({ storageTb: 4, redundancy: "none" })).toMatchObject({
      storageRawTbRequired: 4,
      storageSlotsRequired: 1,
    });
    expect(needs({ storageTb: 4, redundancy: "mirror" })).toMatchObject({
      storageRawTbRequired: 8,
      storageSlotsRequired: 2,
    });
    expect(needs({ storageTb: 4, redundancy: "raid5" })).toMatchObject({
      storageRawTbRequired: 6,
      storageSlotsRequired: 3,
    });
    expect(needs({ storageTb: 4, redundancy: "raid6" })).toMatchObject({
      storageRawTbRequired: 8,
      storageSlotsRequired: 4,
    });
  });

  it("treats 'unsure' like no redundancy and applies growth", () => {
    expect(needs({ storageTb: 2, redundancy: "unsure" }).redundancy).toBe("none");
    expect(
      needs({ storageTb: 4, redundancy: "mirror", growth2y: "high" }).storageRawTbRequired,
    ).toBe(12);
  });
});

describe("deriveNeeds: the other requirements", () => {
  it("maps network speed and leaves 'unsure' open", () => {
    expect(needs({ lanSpeed: "1g" }).lanSpeedMbpsRequired).toBe(1000);
    expect(needs({ lanSpeed: "2_5g" }).lanSpeedMbpsRequired).toBe(2500);
    expect(needs({ lanSpeed: "10g" }).lanSpeedMbpsRequired).toBe(10000);
    expect(needs({ lanSpeed: "unsure" }).lanSpeedMbpsRequired).toBeNull();
    expect(needs({}).lanSpeedMbpsRequired).toBeNull();
  });

  it("maps noise, GPU, Wi-Fi and the power limit", () => {
    expect(needs({ noiseLevel: "silent" }).noiseAllowed).toBe("silent");
    expect(needs({ noiseLevel: "loud_ok" }).noiseAllowed).toBe("loud");
    expect(needs({}).noiseAllowed).toBeNull();
    expect(needs({ gpuNeeded: true }).gpuRequired).toBe(true);
    expect(needs({}).gpuRequired).toBeNull();
    expect(needs({ wifiNeeded: true }).wifiRequired).toBe(true);
    // A power limit only applies to an always-on server.
    expect(needs({ alwaysOn: true, maxPowerWatts: 60 }).maxWatts).toBe(60);
    expect(needs({ alwaysOn: false, maxPowerWatts: 60 }).maxWatts).toBeNull();
  });

  it("prefers the questionnaire budget and falls back to the lead's", () => {
    expect(
      needs({ budgetMaxDzd: 200000 }, { budgetMinDzd: 1, budgetMaxDzd: 999 }).budgetMaxDzd,
    ).toBe(200000);
    expect(needs({}, { budgetMinDzd: 50000, budgetMaxDzd: 150000 })).toMatchObject({
      budgetMinDzd: 50000,
      budgetMaxDzd: 150000,
    });
    expect(needs({}).budgetMaxDzd).toBeNull();
  });

  it("flags a VLAN requirement as an assumption (it needs a managed switch, not a bigger machine)", () => {
    expect(needs({ vlanNeeded: true }).assumptions.some((a) => a.id === "vlan")).toBe(true);
    expect(needs({ vlanNeeded: false }).assumptions.some((a) => a.id === "vlan")).toBe(false);
  });

  it("ignores unknown workloads and wrong-typed answers instead of failing", () => {
    expect(() =>
      needs({
        workloads: ["time_travel"],
        concurrentUsers: "lots" as never,
        storageTb: "x" as never,
      }),
    ).not.toThrow();
    expect(needs({ workloads: "file_storage" as never }).ramGbRequired).toBe(4);
  });

  it("is deterministic", () => {
    const answers: Answers = {
      workloads: ["containers", "media"],
      containerCount: 12,
      growth2y: "some",
      storageTb: 6,
      redundancy: "raid5",
    };
    expect(needs(answers)).toEqual(needs(structuredClone(answers)));
  });
});
