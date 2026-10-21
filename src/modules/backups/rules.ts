/**
 * Backup health and remote-access readiness as pure functions. No I/O and no clock: callers pass
 * `now`, so every rule is deterministic and unit-tested.
 *
 * The central idea (FR-9): a backup nobody has restored is only a hope. A policy is healthy only
 * when backups keep arriving AND a restore has been proven recently.
 */

const DAY_MS = 86_400_000;

export const BACKUP_OUTCOMES = ["success", "partial", "failed"] as const;
export type BackupOutcome = (typeof BACKUP_OUTCOMES)[number];

export const RESTORE_OUTCOMES = ["success", "failed"] as const;
export type RestoreOutcome = (typeof RESTORE_OUTCOMES)[number];

/** A backup may arrive this many days late before the policy is called overdue. */
export const BACKUP_GRACE_DAYS = 1;
/** A recovery procedure not reviewed for this long is considered stale. */
export const RECOVERY_REVIEW_DAYS = 365;

const daysBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / DAY_MS;

// ---------------------------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------------------------

export type BackupStatus = "inactive" | "failed" | "overdue" | "partial" | "ok";

export interface BackupFacts {
  active: boolean;
  /** Expected interval between successful backups, in days. */
  frequencyDays: number;
  createdAt: Date;
  /** The most recent run, whatever its outcome. */
  latest: { ranAt: Date; outcome: BackupOutcome } | null;
  /** The most recent run that succeeded. */
  lastSuccessAt: Date | null;
}

/**
 * inactive  the policy is switched off
 * failed    the latest run failed
 * overdue   no success within the expected interval plus the grace period
 *           (a new policy is measured from its creation date)
 * partial   the latest run only partly worked
 * ok        otherwise
 */
export function backupStatus(facts: BackupFacts, now: Date): BackupStatus {
  if (!facts.active) return "inactive";
  if (facts.latest?.outcome === "failed") return "failed";
  const reference = facts.lastSuccessAt ?? facts.createdAt;
  if (daysBetween(reference, now) > facts.frequencyDays + BACKUP_GRACE_DAYS) return "overdue";
  if (facts.latest?.outcome === "partial") return "partial";
  return "ok";
}

/** When the next successful backup is expected (null if nothing has ever been recorded). */
export function nextBackupExpected(facts: BackupFacts): Date | null {
  const reference = facts.lastSuccessAt ?? facts.createdAt;
  return new Date(reference.getTime() + facts.frequencyDays * DAY_MS);
}

// ---------------------------------------------------------------------------------------------
// Restore tests
// ---------------------------------------------------------------------------------------------

export type RestoreStatus = "ok" | "never_tested" | "failed" | "overdue";

export interface RestoreFacts {
  /** The policy must be restore-tested at least this often (days). */
  restoreTestEveryDays: number;
  latest: { testedAt: Date; outcome: RestoreOutcome } | null;
  lastSuccessAt: Date | null;
}

/**
 * never_tested  no restore has ever been proven
 * failed        the latest test failed (a problem to fix, even if an older one succeeded)
 * overdue       the last proven restore is older than the required interval
 * ok            otherwise
 */
export function restoreStatus(facts: RestoreFacts, now: Date): RestoreStatus {
  if (!facts.latest) return "never_tested";
  if (facts.latest.outcome === "failed") return "failed";
  if (!facts.lastSuccessAt) return "never_tested";
  if (daysBetween(facts.lastSuccessAt, now) > facts.restoreTestEveryDays) return "overdue";
  return "ok";
}

// ---------------------------------------------------------------------------------------------
// Overall health
// ---------------------------------------------------------------------------------------------

export type Health = "critical" | "warning" | "ok" | "inactive";

/**
 * critical  a backup or a restore test failed: act now
 * warning   backups are late/partial or a restore was never proven / is overdue
 * ok        both are fine
 * inactive  the policy is off
 */
export function overallHealth(backup: BackupStatus, restore: RestoreStatus): Health {
  if (backup === "inactive") return "inactive";
  if (backup === "failed" || restore === "failed") return "critical";
  if (backup === "overdue" || backup === "partial") return "warning";
  if (restore === "never_tested" || restore === "overdue") return "warning";
  return "ok";
}

export type RecoveryDocState = "missing" | "stale" | "ok";

export function recoveryDocState(
  procedure: string | null | undefined,
  reviewedAt: Date | null,
  now: Date,
): RecoveryDocState {
  if (!procedure?.trim()) return "missing";
  if (!reviewedAt || daysBetween(reviewedAt, now) > RECOVERY_REVIEW_DAYS) return "stale";
  return "ok";
}

/** Order for lists: the policies that need attention first. */
export const HEALTH_RANK: Record<Health, number> = { critical: 0, warning: 1, ok: 2, inactive: 3 };

// ---------------------------------------------------------------------------------------------
// Remote access plans (documentation only)
// ---------------------------------------------------------------------------------------------

export const REMOTE_PLAN_STATUSES = ["draft", "approved", "retired"] as const;
export type RemotePlanStatus = (typeof REMOTE_PLAN_STATUSES)[number];

/** draft ─▶ approved ─▶ retired ;  draft ─▶ retired. Approved plans are not edited: retire and replace. */
const PLAN_TRANSITIONS: Record<RemotePlanStatus, readonly RemotePlanStatus[]> = {
  draft: ["approved", "retired"],
  approved: ["retired"],
  retired: [],
};

export const allowedNextPlanStatuses = (from: RemotePlanStatus) => PLAN_TRANSITIONS[from];
export const canTransitionPlan = (from: RemotePlanStatus, to: RemotePlanStatus) =>
  PLAN_TRANSITIONS[from].includes(to);

export const TAILNET_OWNERS = ["customer", "provider"] as const;
export type TailnetOwner = (typeof TAILNET_OWNERS)[number];

/** The safeguards the security policy asks for (SECURITY_MODEL §8). `true` means "in place". */
export const SAFEGUARDS = [
  "deviceApproval",
  "keyExpiry",
  "noPublicExposure",
  "noSubnetOrExit",
  "mfa",
] as const;
export type Safeguard = (typeof SAFEGUARDS)[number];

export interface PlanFacts {
  tailnetOwner: TailnetOwner;
  safeguards: Record<Safeguard, boolean>;
  exceptions: string | null | undefined;
}

export type PlanGap = Safeguard | "provider_tailnet";

/** Where the plan departs from the policy; each gap must be explained to approve the plan. */
export function planGaps(plan: PlanFacts): PlanGap[] {
  const gaps: PlanGap[] = SAFEGUARDS.filter((s) => !plan.safeguards[s]);
  if (plan.tailnetOwner !== "customer") gaps.push("provider_tailnet");
  return gaps;
}

/** A plan is approvable when it follows the policy, or every departure is explained in writing. */
export function canApprovePlan(plan: PlanFacts): { ok: boolean; gaps: PlanGap[] } {
  const gaps = planGaps(plan);
  return { ok: gaps.length === 0 || Boolean(plan.exceptions?.trim()), gaps };
}
