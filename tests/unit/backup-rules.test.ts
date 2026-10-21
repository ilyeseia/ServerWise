import { describe, expect, it } from "vitest";
import {
  HEALTH_RANK,
  REMOTE_PLAN_STATUSES,
  SAFEGUARDS,
  allowedNextPlanStatuses,
  backupStatus,
  canApprovePlan,
  canTransitionPlan,
  nextBackupExpected,
  overallHealth,
  planGaps,
  recoveryDocState,
  restoreStatus,
  type BackupFacts,
  type PlanFacts,
  type RestoreFacts,
} from "@/modules/backups/rules";

const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const NOW = day("2026-10-21");

const backup = (over: Partial<BackupFacts> = {}): BackupFacts => ({
  active: true,
  frequencyDays: 1,
  createdAt: day("2026-01-01"),
  latest: { ranAt: day("2026-10-21"), outcome: "success" },
  lastSuccessAt: day("2026-10-21"),
  ...over,
});

describe("backup status", () => {
  it("is ok while backups arrive on time", () => {
    expect(backupStatus(backup(), NOW)).toBe("ok");
    // Yesterday's backup of a daily policy is fine; two days is inside the grace period.
    expect(
      backupStatus(
        backup({
          lastSuccessAt: day("2026-10-19"),
          latest: { ranAt: day("2026-10-19"), outcome: "success" },
        }),
        NOW,
      ),
    ).toBe("ok");
  });

  it("becomes overdue after the interval plus the grace period", () => {
    const old = day("2026-10-18"); // 3 days > 1 + 1
    expect(
      backupStatus(backup({ lastSuccessAt: old, latest: { ranAt: old, outcome: "success" } }), NOW),
    ).toBe("overdue");
    // A weekly policy tolerates a week and a day.
    const week = day("2026-10-14"); // 7 days
    expect(
      backupStatus(
        backup({
          frequencyDays: 7,
          lastSuccessAt: week,
          latest: { ranAt: week, outcome: "success" },
        }),
        NOW,
      ),
    ).toBe("ok");
    const nine = day("2026-10-11"); // 10 days
    expect(
      backupStatus(
        backup({
          frequencyDays: 7,
          lastSuccessAt: nine,
          latest: { ranAt: nine, outcome: "success" },
        }),
        NOW,
      ),
    ).toBe("overdue");
  });

  it("measures a brand-new policy from its creation date", () => {
    const fresh = backup({ createdAt: day("2026-10-21"), latest: null, lastSuccessAt: null });
    expect(backupStatus(fresh, NOW)).toBe("ok");
    const neglected = backup({ createdAt: day("2026-09-01"), latest: null, lastSuccessAt: null });
    expect(backupStatus(neglected, NOW)).toBe("overdue");
  });

  it("reports a failed latest run even if the last success is recent", () => {
    expect(
      backupStatus(backup({ latest: { ranAt: day("2026-10-21"), outcome: "failed" } }), NOW),
    ).toBe("failed");
  });

  it("flags a partial run, but lateness comes first", () => {
    expect(
      backupStatus(backup({ latest: { ranAt: day("2026-10-21"), outcome: "partial" } }), NOW),
    ).toBe("partial");
    const old = day("2026-10-10");
    expect(
      backupStatus(
        backup({ lastSuccessAt: old, latest: { ranAt: day("2026-10-21"), outcome: "partial" } }),
        NOW,
      ),
    ).toBe("overdue");
  });

  it("an inactive policy is just inactive", () => {
    expect(
      backupStatus(backup({ active: false, latest: { ranAt: NOW, outcome: "failed" } }), NOW),
    ).toBe("inactive");
  });

  it("tells when the next backup is expected", () => {
    expect(
      nextBackupExpected(backup({ frequencyDays: 7 }))!
        .toISOString()
        .slice(0, 10),
    ).toBe("2026-10-28");
    expect(
      nextBackupExpected(
        backup({
          latest: null,
          lastSuccessAt: null,
          createdAt: day("2026-10-01"),
          frequencyDays: 2,
        }),
      )!
        .toISOString()
        .slice(0, 10),
    ).toBe("2026-10-03");
  });
});

describe("restore status", () => {
  const restore = (over: Partial<RestoreFacts> = {}): RestoreFacts => ({
    restoreTestEveryDays: 90,
    latest: { testedAt: day("2026-09-01"), outcome: "success" },
    lastSuccessAt: day("2026-09-01"),
    ...over,
  });

  it("is never_tested until a restore has been proven", () => {
    expect(restoreStatus(restore({ latest: null, lastSuccessAt: null }), NOW)).toBe("never_tested");
  });

  it("is ok within the required interval and overdue after it", () => {
    expect(restoreStatus(restore(), NOW)).toBe("ok");
    expect(restoreStatus(restore({ lastSuccessAt: day("2026-07-23") }), NOW)).toBe("ok"); // exactly 90 days
    expect(restoreStatus(restore({ lastSuccessAt: day("2026-07-22") }), NOW)).toBe("overdue"); // 91 days
    expect(
      restoreStatus(
        restore({
          lastSuccessAt: day("2026-07-01"),
          latest: { testedAt: day("2026-07-01"), outcome: "success" },
        }),
        NOW,
      ),
    ).toBe("overdue");
  });

  it("a failed latest test is a failure even if an older one succeeded", () => {
    expect(
      restoreStatus(restore({ latest: { testedAt: day("2026-10-20"), outcome: "failed" } }), NOW),
    ).toBe("failed");
  });

  it("a history of only failures is never_tested after the failure is superseded", () => {
    // latest is a success but there is no recorded success date: treated as unproven.
    expect(restoreStatus(restore({ lastSuccessAt: null }), NOW)).toBe("never_tested");
  });
});

describe("overall health", () => {
  it("combines the two checks", () => {
    expect(overallHealth("ok", "ok")).toBe("ok");
    expect(overallHealth("failed", "ok")).toBe("critical");
    expect(overallHealth("ok", "failed")).toBe("critical");
    expect(overallHealth("overdue", "ok")).toBe("warning");
    expect(overallHealth("partial", "ok")).toBe("warning");
    expect(overallHealth("ok", "never_tested")).toBe("warning");
    expect(overallHealth("ok", "overdue")).toBe("warning");
    expect(overallHealth("inactive", "failed")).toBe("inactive");
  });

  it("a backup that has never been restored is never reported as healthy", () => {
    expect(overallHealth("ok", "never_tested")).not.toBe("ok");
  });

  it("orders the problems first", () => {
    const order = (["ok", "inactive", "critical", "warning"] as const)
      .slice()
      .sort((a, b) => HEALTH_RANK[a] - HEALTH_RANK[b]);
    expect(order).toEqual(["critical", "warning", "ok", "inactive"]);
  });
});

describe("recovery documentation", () => {
  it("is missing, stale or ok", () => {
    expect(recoveryDocState(null, null, NOW)).toBe("missing");
    expect(recoveryDocState("   ", day("2026-10-01"), NOW)).toBe("missing");
    expect(recoveryDocState("Steps…", null, NOW)).toBe("stale");
    expect(recoveryDocState("Steps…", day("2025-01-01"), NOW)).toBe("stale");
    expect(recoveryDocState("Steps…", day("2026-06-01"), NOW)).toBe("ok");
  });
});

describe("remote access plans", () => {
  const compliant = (): PlanFacts => ({
    tailnetOwner: "customer",
    safeguards: Object.fromEntries(SAFEGUARDS.map((s) => [s, true])) as PlanFacts["safeguards"],
    exceptions: null,
  });

  it("moves only forward and approved plans are not edited, only retired", () => {
    expect(REMOTE_PLAN_STATUSES.map((s) => [s, [...allowedNextPlanStatuses(s)].sort()])).toEqual([
      ["draft", ["approved", "retired"]],
      ["approved", ["retired"]],
      ["retired", []],
    ]);
    expect(canTransitionPlan("approved", "draft")).toBe(false);
    expect(canTransitionPlan("retired", "approved")).toBe(false);
  });

  it("a plan that follows the policy has no gaps and can be approved", () => {
    expect(planGaps(compliant())).toEqual([]);
    expect(canApprovePlan(compliant())).toEqual({ ok: true, gaps: [] });
  });

  it("lists every departure from the policy", () => {
    const plan = compliant();
    plan.safeguards.noPublicExposure = false;
    plan.safeguards.mfa = false;
    plan.tailnetOwner = "provider";
    expect(planGaps(plan)).toEqual(["noPublicExposure", "mfa", "provider_tailnet"]);
  });

  it("departures need a written explanation before approval", () => {
    const plan = compliant();
    plan.safeguards.noSubnetOrExit = false;
    expect(canApprovePlan(plan)).toEqual({ ok: false, gaps: ["noSubnetOrExit"] });
    expect(canApprovePlan({ ...plan, exceptions: "   " }).ok).toBe(false);
    expect(
      canApprovePlan({
        ...plan,
        exceptions: "Subnet router needed for the NAS VLAN, approved by the customer",
      }).ok,
    ).toBe(true);
  });
});
