import type { Answers } from "@/modules/questionnaire/types";
import type { Assumption, Needs, NoiseClass, StorageRedundancy } from "./types";

/**
 * Turns questionnaire answers into numeric requirements.
 *
 * IMPORTANT: the per-workload figures below are ENGINEERING ASSUMPTIONS (rules of thumb for
 * sizing a small server), not measurements. They are listed here, shown to the user as
 * "assumptions" next to every recommendation, and meant to be reviewed and tuned by the owner.
 * They never produce prices; they only describe how much machine a workload tends to need.
 */

/** Standard memory sizes the requirement is rounded up to. */
export const RAM_STEPS = [4, 8, 16, 32, 64, 128, 256, 512] as const;

interface WorkloadProfile {
  /** Fixed memory (GB) and CPU benchmark points the workload adds. */
  ramGb: number;
  cpu: number;
  /** Extra per counted unit (containers, VMs, cameras, devices), from another answer. */
  perUnit?: { answer: string; ramGb: number; cpu: number; defaultUnits: number };
}

export const BASE_PROFILE = { ramGb: 4, cpu: 2000 } as const; // operating system and services

export const WORKLOAD_PROFILES: Record<string, WorkloadProfile> = {
  file_storage: { ramGb: 2, cpu: 500 },
  containers: {
    ramGb: 2,
    cpu: 1000,
    perUnit: { answer: "containerCount", ramGb: 0.25, cpu: 60, defaultUnits: 10 },
  },
  home_automation: {
    ramGb: 1,
    cpu: 500,
    perUnit: { answer: "homeDeviceCount", ramGb: 0.01, cpu: 5, defaultUnits: 30 },
  },
  virtualization: {
    ramGb: 4,
    cpu: 2500,
    perUnit: { answer: "vmCount", ramGb: 3, cpu: 1500, defaultUnits: 2 },
  },
  media: { ramGb: 4, cpu: 3000 },
  backup_target: { ramGb: 2, cpu: 500 },
  surveillance: {
    ramGb: 2,
    cpu: 1500,
    perUnit: { answer: "cameraCount", ramGb: 0.5, cpu: 400, defaultUnits: 4 },
  },
  remote_access_vpn: { ramGb: 1, cpu: 500 },
  web_hosting: { ramGb: 3, cpu: 1500 },
  dev_test: { ramGb: 6, cpu: 4000 },
  other: { ramGb: 2, cpu: 1000 },
};

const GROWTH: Record<string, number> = { none: 1, some: 1.25, high: 1.5 };
const CPU_PRIORITY: Record<string, number> = { low_power: 0.9, balanced: 1, performance: 1.4 };
/** Raw capacity needed per usable TB, by redundancy level (assumes typical 2-4 drive layouts). */
const RAW_MULTIPLIER: Record<StorageRedundancy, number> = {
  none: 1,
  mirror: 2,
  raid5: 1.5,
  raid6: 2,
};
const MIN_SLOTS: Record<StorageRedundancy, number> = { none: 1, mirror: 2, raid5: 3, raid6: 4 };
const LAN_MBPS: Record<string, number> = { "1g": 1000, "2_5g": 2500, "10g": 10000 };
const NOISE: Record<string, NoiseClass> = {
  silent: "silent",
  quiet: "quiet",
  normal: "normal",
  loud_ok: "loud",
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const roundTo = (value: number, step: number) => Math.round(value / step) * step;

function stepUp(value: number): number {
  return RAM_STEPS.find((s) => s >= value) ?? RAM_STEPS[RAM_STEPS.length - 1]!;
}

export interface LeadBudget {
  budgetMinDzd: number | null;
  budgetMaxDzd: number | null;
}

export function deriveNeeds(
  answers: Answers,
  leadBudget: LeadBudget = { budgetMinDzd: null, budgetMaxDzd: null },
): Needs {
  const assumptions: Assumption[] = [];
  const workloads = Array.isArray(answers.workloads) ? (answers.workloads as string[]) : [];

  let ram = BASE_PROFILE.ramGb;
  let cpu: number = BASE_PROFILE.cpu;

  for (const id of workloads) {
    const profile = WORKLOAD_PROFILES[id];
    if (!profile) continue;
    ram += profile.ramGb;
    cpu += profile.cpu;
    if (profile.perUnit) {
      const stated = num(answers[profile.perUnit.answer]);
      const units = stated ?? profile.perUnit.defaultUnits;
      if (stated === null) {
        assumptions.push({
          id: "defaulted",
          params: { question: profile.perUnit.answer, value: units },
        });
      }
      ram += units * profile.perUnit.ramGb;
      cpu += units * profile.perUnit.cpu;
    }
  }

  const users = num(answers.concurrentUsers) ?? 0;
  ram += Math.min(8, Math.floor(users / 10));
  cpu += Math.min(3000, users * 50);

  const growthFactor = GROWTH[String(answers.growth2y)] ?? 1;
  if (growthFactor !== 1) assumptions.push({ id: "growth", params: { factor: growthFactor } });

  const derivedRam = stepUp(ram * growthFactor);
  let ramGbRequired = derivedRam;
  const statedRam = typeof answers.ramGb === "string" ? Number(answers.ramGb) : NaN;
  if (Number.isFinite(statedRam) && statedRam > 0) {
    ramGbRequired = Math.max(derivedRam, statedRam);
    assumptions.push({
      id: "ram_stated",
      params: { stated: statedRam, derived: derivedRam, used: ramGbRequired },
    });
  } else {
    assumptions.push({
      id: "ram_derived",
      params: { raw: Math.round(ram * 10) / 10, required: ramGbRequired },
    });
  }

  const priority = CPU_PRIORITY[String(answers.cpuPriority)] ?? 1;
  const cpuBenchmarkRequired = Math.max(2000, roundTo(cpu * growthFactor * priority, 500));
  assumptions.push({ id: "cpu_derived", params: { required: cpuBenchmarkRequired, priority } });

  // Storage: usable capacity -> raw capacity (redundancy overhead, growth) and minimum drive slots.
  const storageTb = num(answers.storageTb) ?? 0;
  const redundancyAnswer = String(answers.redundancy);
  const redundancy: StorageRedundancy =
    redundancyAnswer in RAW_MULTIPLIER ? (redundancyAnswer as StorageRedundancy) : "none";
  const storageRawTbRequired =
    Math.round(storageTb * growthFactor * RAW_MULTIPLIER[redundancy] * 100) / 100;
  const storageSlotsRequired = storageTb > 0 ? MIN_SLOTS[redundancy] : 0;
  if (storageTb > 0) {
    assumptions.push({
      id: "storage_raw",
      params: {
        usable: storageTb,
        multiplier: RAW_MULTIPLIER[redundancy],
        raw: storageRawTbRequired,
        slots: storageSlotsRequired,
      },
    });
  }

  if (answers.vlanNeeded === true) assumptions.push({ id: "vlan", params: {} });

  const alwaysOn = bool(answers.alwaysOn);
  const watts = alwaysOn === true ? num(answers.maxPowerWatts) : null;

  return {
    ramGbRequired,
    cpuBenchmarkRequired,
    storageTb,
    storageRawTbRequired,
    storageSlotsRequired,
    redundancy,
    lanSpeedMbpsRequired: LAN_MBPS[String(answers.lanSpeed)] ?? null,
    wifiRequired: bool(answers.wifiNeeded),
    gpuRequired: bool(answers.gpuNeeded),
    noiseAllowed: NOISE[String(answers.noiseLevel)] ?? null,
    maxWatts: watts,
    alwaysOn,
    budgetMinDzd: num(answers.budgetMinDzd) ?? leadBudget.budgetMinDzd,
    budgetMaxDzd: num(answers.budgetMaxDzd) ?? leadBudget.budgetMaxDzd,
    growthFactor,
    assumptions,
  };
}
