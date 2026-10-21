import type { Prisma } from "@/generated/prisma/client";
import { notFound, orNull, type CrmContext, type Page } from "@/modules/crm/context";
import { pageInput } from "@/modules/crm/schemas";
import { auditData } from "@/server/audit/tx";
import { assertCan, RuleViolationError } from "@/server/authz/guard";
import { getDb } from "@/server/db/client";
import {
  HEALTH_RANK,
  allowedNextPlanStatuses,
  backupStatus,
  canApprovePlan,
  nextBackupExpected,
  overallHealth,
  planGaps,
  recoveryDocState,
  restoreStatus,
  type BackupOutcome,
  type BackupStatus,
  type Health,
  type RecoveryDocState,
  type RemotePlanStatus,
  type RestoreOutcome,
  type RestoreStatus,
} from "./rules";
import {
  backupPolicyInput,
  backupRecordInput,
  remotePlanInput,
  restoreTestInput,
  type BackupPolicyInput,
  type BackupRecordInput,
  type RemotePlanInput,
  type RestoreTestInput,
} from "./schemas";

type Tx = Prisma.TransactionClient;

/** A run or a drill cannot be recorded for the future (small tolerance for clock differences). */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

// ---------------------------------------------------------------------------------------------
// Health computation
// ---------------------------------------------------------------------------------------------

export interface PolicyHealth {
  backup: BackupStatus;
  restore: RestoreStatus;
  health: Health;
  recoveryDoc: RecoveryDocState;
  lastBackupAt: Date | null;
  lastSuccessAt: Date | null;
  nextExpected: Date | null;
  lastRestoreSuccessAt: Date | null;
}

type PolicyRow = Prisma.BackupPolicyGetPayload<{
  include: {
    customer: { select: { id: true; name: true } };
    records: true;
    restoreTests: true;
  };
}>;

/**
 * Newest first. People record a day, not a time, so two entries often share the same instant: the
 * one entered last (createdAt) is then the more recent, e.g. a failed drill after a successful
 * one on the same day must count as the latest.
 */
function newestFirst<T extends { createdAt: Date }>(items: T[], when: (item: T) => Date): T[] {
  return [...items].sort(
    (a, b) =>
      when(b).getTime() - when(a).getTime() || b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

function computeHealth(policy: PolicyRow, now: Date): PolicyHealth {
  const records = newestFirst(policy.records, (r) => r.ranAt);
  const tests = newestFirst(policy.restoreTests, (t) => t.testedAt);
  const latest = records[0] ?? null;
  const lastSuccess = records.find((r) => r.outcome === "success") ?? null;
  const latestTest = tests[0] ?? null;
  const lastRestoreSuccess = tests.find((t) => t.outcome === "success") ?? null;

  const facts = {
    active: policy.active,
    frequencyDays: policy.frequencyDays,
    createdAt: policy.createdAt,
    latest: latest ? { ranAt: latest.ranAt, outcome: latest.outcome as BackupOutcome } : null,
    lastSuccessAt: lastSuccess?.ranAt ?? null,
  };
  const backup = backupStatus(facts, now);
  const restore = restoreStatus(
    {
      restoreTestEveryDays: policy.restoreTestEveryDays,
      latest: latestTest
        ? { testedAt: latestTest.testedAt, outcome: latestTest.outcome as RestoreOutcome }
        : null,
      lastSuccessAt: lastRestoreSuccess?.testedAt ?? null,
    },
    now,
  );
  return {
    backup,
    restore,
    health: overallHealth(backup, restore),
    recoveryDoc: recoveryDocState(policy.recoveryProcedure, policy.recoveryReviewedAt, now),
    lastBackupAt: latest?.ranAt ?? null,
    lastSuccessAt: lastSuccess?.ranAt ?? null,
    nextExpected: policy.active ? nextBackupExpected(facts) : null,
    lastRestoreSuccessAt: lastRestoreSuccess?.testedAt ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Policies: reading
// ---------------------------------------------------------------------------------------------

export interface PolicyListItem extends PolicyHealth {
  id: string;
  name: string;
  kind: string;
  customerId: string;
  customerName: string;
  frequencyDays: number;
  active: boolean;
}

export async function listPolicies(
  ctx: CrmContext,
  query: { customerId?: string; health?: Health; page?: number; pageSize?: number } = {},
  now = new Date(),
): Promise<Page<PolicyListItem>> {
  assertCan(ctx.actor, "backup:read");
  const { page, pageSize } = pageInput.parse({ page: query.page, pageSize: query.pageSize });
  const rows = await getDb().backupPolicy.findMany({
    where: query.customerId ? { customerId: query.customerId } : {},
    include: {
      customer: { select: { id: true, name: true } },
      records: true,
      restoreTests: true,
    },
    take: 500,
  });
  const items = rows
    .map((policy): PolicyListItem => {
      const health = computeHealth(policy, now);
      return {
        id: policy.id,
        name: policy.name,
        kind: policy.kind,
        customerId: policy.customerId,
        customerName: policy.customer.name,
        frequencyDays: policy.frequencyDays,
        active: policy.active,
        ...health,
      };
    })
    .filter((item) => !query.health || item.health === query.health)
    // Problems first, then by customer and name, so the list is stable.
    .sort(
      (a, b) =>
        HEALTH_RANK[a.health] - HEALTH_RANK[b.health] ||
        a.customerName.localeCompare(b.customerName) ||
        a.name.localeCompare(b.name),
    );
  return {
    total: items.length,
    page,
    pageSize,
    items: items.slice((page - 1) * pageSize, page * pageSize),
  };
}

export async function getPolicy(ctx: CrmContext, id: string, now = new Date()) {
  assertCan(ctx.actor, "backup:read");
  const policy = await getDb().backupPolicy.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true } },
      asset: { select: { id: true, name: true } },
      records: true,
      restoreTests: true,
    },
  });
  if (!policy) throw notFound("Backup policy");
  const health = computeHealth(policy, now);
  return {
    id: policy.id,
    customer: policy.customer,
    asset: policy.asset,
    name: policy.name,
    kind: policy.kind,
    frequencyDays: policy.frequencyDays,
    retentionDays: policy.retentionDays,
    destination: policy.destination,
    encrypted: policy.encrypted,
    encryptionKeyRef: policy.encryptionKeyRef,
    offsite: policy.offsite,
    restoreTestEveryDays: policy.restoreTestEveryDays,
    recoveryProcedure: policy.recoveryProcedure,
    recoveryReviewedAt: policy.recoveryReviewedAt,
    active: policy.active,
    notes: policy.notes,
    createdAt: policy.createdAt,
    ...health,
    records: newestFirst(policy.records, (r) => r.ranAt)
      .slice(0, 30)
      .map((r) => ({
        id: r.id,
        ranAt: r.ranAt,
        outcome: r.outcome,
        sizeMb: r.sizeMb,
        notes: r.notes,
      })),
    restoreTests: newestFirst(policy.restoreTests, (t) => t.testedAt)
      .slice(0, 30)
      .map((t) => ({
        id: t.id,
        testedAt: t.testedAt,
        outcome: t.outcome,
        durationMinutes: t.durationMinutes,
        notes: t.notes,
      })),
  };
}

export interface BackupStats {
  policies: number;
  critical: number;
  warning: number;
  neverTested: number;
}

/** Counts for the dashboard, computed from the data. */
export async function getBackupStats(ctx: CrmContext, now = new Date()): Promise<BackupStats> {
  assertCan(ctx.actor, "backup:read");
  const all = await listPolicies(ctx, { pageSize: 100 }, now);
  // listPolicies caps a page at 100; walk the remaining pages for the totals.
  const items = [...all.items];
  for (let page = 2; items.length < all.total; page++) {
    items.push(...(await listPolicies(ctx, { page, pageSize: 100 }, now)).items);
  }
  const active = items.filter((i) => i.active);
  return {
    policies: active.length,
    critical: active.filter((i) => i.health === "critical").length,
    warning: active.filter((i) => i.health === "warning").length,
    neverTested: active.filter((i) => i.restore === "never_tested").length,
  };
}

// ---------------------------------------------------------------------------------------------
// Policies: writing
// ---------------------------------------------------------------------------------------------

async function checkPolicyReferences(tx: Tx, data: ReturnType<typeof backupPolicyInput.parse>) {
  const customer = await tx.customer.findUnique({ where: { id: data.customerId } });
  if (!customer) throw notFound("Customer");
  if (customer.status === "archived") {
    throw new RuleViolationError("CUSTOMER_ARCHIVED", "The customer is archived");
  }
  if (data.assetId) {
    const asset = await tx.asset.findUnique({ where: { id: data.assetId } });
    if (!asset) throw notFound("Asset");
    if (asset.customerId !== data.customerId) {
      throw new RuleViolationError(
        "ASSET_CUSTOMER_MISMATCH",
        "The asset belongs to another customer",
      );
    }
  }
}

const policyData = (data: ReturnType<typeof backupPolicyInput.parse>) => ({
  assetId: orNull(data.assetId),
  name: data.name,
  kind: data.kind,
  frequencyDays: data.frequencyDays,
  retentionDays: orNull(data.retentionDays),
  destination: data.destination,
  encrypted: orNull(data.encrypted),
  encryptionKeyRef: orNull(data.encryptionKeyRef),
  offsite: orNull(data.offsite),
  restoreTestEveryDays: data.restoreTestEveryDays,
  active: data.active,
  notes: orNull(data.notes),
});

export async function createPolicy(ctx: CrmContext, input: BackupPolicyInput, now = new Date()) {
  assertCan(ctx.actor, "backup:write");
  const actor = ctx.actor;
  const data = backupPolicyInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    await checkPolicyReferences(tx, data);
    const policy = await tx.backupPolicy.create({
      data: {
        customerId: data.customerId,
        createdById: actor.id,
        ...policyData(data),
        recoveryProcedure: orNull(data.recoveryProcedure),
        recoveryReviewedAt: data.recoveryProcedure ? now : null,
      },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "backuppolicy.created",
        "backup_policy",
        policy.id,
        { customerId: data.customerId },
        ctx.client,
      ),
    });
    return { id: policy.id };
  });
}

/** Editing the recovery procedure counts as a review; so does `markRecoveryReviewed`. */
export async function updatePolicy(
  ctx: CrmContext,
  id: string,
  input: BackupPolicyInput,
  now = new Date(),
) {
  assertCan(ctx.actor, "backup:write");
  const actor = ctx.actor;
  const data = backupPolicyInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const policy = await tx.backupPolicy.findUnique({ where: { id } });
    if (!policy) throw notFound("Backup policy");
    if (policy.customerId !== data.customerId) {
      throw new RuleViolationError("POLICY_CUSTOMER_FIXED", "A policy cannot change customer");
    }
    await checkPolicyReferences(tx, data);
    const procedureChanged =
      (data.recoveryProcedure ?? null) !== (policy.recoveryProcedure ?? null);
    await tx.backupPolicy.update({
      where: { id },
      data: {
        ...policyData(data),
        recoveryProcedure: orNull(data.recoveryProcedure),
        recoveryReviewedAt: !data.recoveryProcedure
          ? null
          : procedureChanged
            ? now
            : policy.recoveryReviewedAt,
      },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "backuppolicy.updated",
        "backup_policy",
        id,
        { active: data.active },
        ctx.client,
      ),
    });
    return { id };
  });
}

export async function markRecoveryReviewed(ctx: CrmContext, id: string, now = new Date()) {
  assertCan(ctx.actor, "backup:write");
  const actor = ctx.actor;
  const db = getDb();

  return db.$transaction(async (tx) => {
    const policy = await tx.backupPolicy.findUnique({ where: { id } });
    if (!policy) throw notFound("Backup policy");
    if (!policy.recoveryProcedure?.trim()) {
      throw new RuleViolationError("RECOVERY_MISSING", "Write the recovery procedure first");
    }
    await tx.backupPolicy.update({ where: { id }, data: { recoveryReviewedAt: now } });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "backuppolicy.updated",
        "backup_policy",
        id,
        { reviewed: true },
        ctx.client,
      ),
    });
    return { id };
  });
}

/** Saves the recovery procedure on its own (the policy form keeps the rest). */
export async function saveRecoveryProcedure(
  ctx: CrmContext,
  id: string,
  procedure: string,
  now = new Date(),
) {
  assertCan(ctx.actor, "backup:write");
  const actor = ctx.actor;
  const text = procedure.trim();
  if (text.length > 4000) throw new RuleViolationError("VALIDATION", "Too long");
  const db = getDb();

  return db.$transaction(async (tx) => {
    const policy = await tx.backupPolicy.findUnique({ where: { id } });
    if (!policy) throw notFound("Backup policy");
    await tx.backupPolicy.update({
      where: { id },
      data: { recoveryProcedure: text || null, recoveryReviewedAt: text ? now : null },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "backuppolicy.updated",
        "backup_policy",
        id,
        { recovery: true },
        ctx.client,
      ),
    });
    return { id };
  });
}

// ---------------------------------------------------------------------------------------------
// Runs and drills (append-only)
// ---------------------------------------------------------------------------------------------

async function activePolicy(tx: Tx, id: string) {
  const policy = await tx.backupPolicy.findUnique({ where: { id } });
  if (!policy) throw notFound("Backup policy");
  if (!policy.active) {
    throw new RuleViolationError("POLICY_INACTIVE", "The policy is switched off");
  }
  return policy;
}

export async function recordBackup(
  ctx: CrmContext,
  policyId: string,
  input: BackupRecordInput,
  now = new Date(),
) {
  assertCan(ctx.actor, "backup:record");
  const actor = ctx.actor;
  const data = backupRecordInput.parse(input);
  if (data.ranAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    throw new RuleViolationError("FUTURE_DATE", "A backup cannot be recorded in the future");
  }
  const db = getDb();

  return db.$transaction(async (tx) => {
    await activePolicy(tx, policyId);
    const record = await tx.backupRecord.create({
      data: {
        policyId,
        ranAt: data.ranAt,
        outcome: data.outcome,
        sizeMb: orNull(data.sizeMb),
        notes: orNull(data.notes),
        recordedById: actor.id,
      },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "backuprecord.recorded",
        "backup_policy",
        policyId,
        { outcome: data.outcome },
        ctx.client,
      ),
    });
    return { id: record.id };
  });
}

export async function recordRestoreTest(
  ctx: CrmContext,
  policyId: string,
  input: RestoreTestInput,
  now = new Date(),
) {
  assertCan(ctx.actor, "backup:record");
  const actor = ctx.actor;
  const data = restoreTestInput.parse(input);
  if (data.testedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    throw new RuleViolationError("FUTURE_DATE", "A restore test cannot be recorded in the future");
  }
  const db = getDb();

  return db.$transaction(async (tx) => {
    await activePolicy(tx, policyId);
    const test = await tx.restoreTest.create({
      data: {
        policyId,
        testedAt: data.testedAt,
        outcome: data.outcome,
        durationMinutes: orNull(data.durationMinutes),
        notes: orNull(data.notes),
        testedById: actor.id,
      },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "restoretest.recorded",
        "backup_policy",
        policyId,
        { outcome: data.outcome },
        ctx.client,
      ),
    });
    return { id: test.id };
  });
}

// ---------------------------------------------------------------------------------------------
// Remote access plans (documentation only)
// ---------------------------------------------------------------------------------------------

export interface PlanListItem {
  id: string;
  title: string;
  status: RemotePlanStatus;
  customerId: string;
  customerName: string;
  tailnetOwner: string;
  gaps: number;
  createdAt: Date;
}

const planSafeguards = (p: {
  deviceApproval: boolean;
  keyExpiry: boolean;
  noPublicExposure: boolean;
  noSubnetOrExit: boolean;
  mfa: boolean;
}) => ({
  deviceApproval: p.deviceApproval,
  keyExpiry: p.keyExpiry,
  noPublicExposure: p.noPublicExposure,
  noSubnetOrExit: p.noSubnetOrExit,
  mfa: p.mfa,
});

export async function listPlans(
  ctx: CrmContext,
  query: { customerId?: string; status?: RemotePlanStatus; page?: number; pageSize?: number } = {},
): Promise<Page<PlanListItem>> {
  assertCan(ctx.actor, "remote:read");
  const { page, pageSize } = pageInput.parse({ page: query.page, pageSize: query.pageSize });
  const where: Prisma.RemoteAccessPlanWhereInput = {
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.status ? { status: query.status } : {}),
  };
  const db = getDb();
  const [total, rows] = await Promise.all([
    db.remoteAccessPlan.count({ where }),
    db.remoteAccessPlan.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { customer: { select: { name: true } } },
    }),
  ]);
  return {
    total,
    page,
    pageSize,
    items: rows.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      customerId: p.customerId,
      customerName: p.customer.name,
      tailnetOwner: p.tailnetOwner,
      gaps: planGaps({
        tailnetOwner: p.tailnetOwner,
        safeguards: planSafeguards(p),
        exceptions: p.exceptions,
      }).length,
      createdAt: p.createdAt,
    })),
  };
}

export async function getPlan(ctx: CrmContext, id: string) {
  assertCan(ctx.actor, "remote:read");
  const plan = await getDb().remoteAccessPlan.findUnique({
    where: { id },
    include: { customer: { select: { id: true, name: true } } },
  });
  if (!plan) throw notFound("Remote access plan");
  const facts = {
    tailnetOwner: plan.tailnetOwner,
    safeguards: planSafeguards(plan),
    exceptions: plan.exceptions,
  };
  const approval = canApprovePlan(facts);
  return {
    ...plan,
    gaps: approval.gaps,
    approvable: approval.ok && plan.status === "draft",
    nextStatuses: allowedNextPlanStatuses(plan.status),
  };
}

const planData = (data: ReturnType<typeof remotePlanInput.parse>) => ({
  title: data.title,
  tailnetOwner: data.tailnetOwner,
  devices: orNull(data.devices),
  aclNotes: orNull(data.aclNotes),
  deviceApproval: data.deviceApproval,
  keyExpiry: data.keyExpiry,
  noPublicExposure: data.noPublicExposure,
  noSubnetOrExit: data.noSubnetOrExit,
  mfa: data.mfa,
  exceptions: orNull(data.exceptions),
});

export async function createPlan(ctx: CrmContext, input: RemotePlanInput) {
  assertCan(ctx.actor, "remote:write");
  const actor = ctx.actor;
  const data = remotePlanInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: data.customerId } });
    if (!customer) throw notFound("Customer");
    if (customer.status === "archived") {
      throw new RuleViolationError("CUSTOMER_ARCHIVED", "The customer is archived");
    }
    const plan = await tx.remoteAccessPlan.create({
      data: { customerId: data.customerId, createdById: actor.id, ...planData(data) },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "remoteplan.created",
        "remote_plan",
        plan.id,
        { customerId: data.customerId },
        ctx.client,
      ),
    });
    return { id: plan.id };
  });
}

/** Only a draft can be edited; an approved plan is retired and replaced. */
export async function updatePlan(ctx: CrmContext, id: string, input: RemotePlanInput) {
  assertCan(ctx.actor, "remote:write");
  const actor = ctx.actor;
  const data = remotePlanInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const plan = await tx.remoteAccessPlan.findUnique({ where: { id } });
    if (!plan) throw notFound("Remote access plan");
    if (plan.customerId !== data.customerId) {
      throw new RuleViolationError("PLAN_CUSTOMER_FIXED", "A plan cannot change customer");
    }
    if (plan.status !== "draft") {
      throw new RuleViolationError("PLAN_LOCKED", "Only a draft plan can be edited");
    }
    await tx.remoteAccessPlan.update({ where: { id }, data: planData(data) });
    await tx.auditLog.create({
      data: auditData(actor, "remoteplan.updated", "remote_plan", id, {}, ctx.client),
    });
    return { id };
  });
}

/** Owner only. A plan that departs from the security policy needs the departure explained. */
export async function approvePlan(ctx: CrmContext, id: string, now = new Date()) {
  assertCan(ctx.actor, "remote:approve");
  const actor = ctx.actor;
  const db = getDb();

  return db.$transaction(async (tx) => {
    const plan = await tx.remoteAccessPlan.findUnique({ where: { id } });
    if (!plan) throw notFound("Remote access plan");
    if (plan.status !== "draft") {
      throw new RuleViolationError("PLAN_LOCKED", "Only a draft plan can be approved");
    }
    const approval = canApprovePlan({
      tailnetOwner: plan.tailnetOwner,
      safeguards: planSafeguards(plan),
      exceptions: plan.exceptions,
    });
    if (!approval.ok) {
      throw new RuleViolationError("GAPS_NOT_EXPLAINED", "Explain each departure from the policy");
    }
    await tx.remoteAccessPlan.update({
      where: { id },
      data: { status: "approved", approvedAt: now, approvedById: actor.id },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "remoteplan.approved",
        "remote_plan",
        id,
        { gaps: approval.gaps.length },
        ctx.client,
      ),
    });
    return { id };
  });
}

export async function retirePlan(ctx: CrmContext, id: string, now = new Date()) {
  assertCan(ctx.actor, "remote:write");
  const actor = ctx.actor;
  const db = getDb();

  return db.$transaction(async (tx) => {
    const plan = await tx.remoteAccessPlan.findUnique({ where: { id } });
    if (!plan) throw notFound("Remote access plan");
    if (plan.status === "retired") {
      throw new RuleViolationError("PLAN_LOCKED", "The plan is already retired");
    }
    await tx.remoteAccessPlan.update({
      where: { id },
      data: { status: "retired", retiredAt: now },
    });
    await tx.auditLog.create({
      data: auditData(actor, "remoteplan.retired", "remote_plan", id, {}, ctx.client),
    });
    return { id };
  });
}
