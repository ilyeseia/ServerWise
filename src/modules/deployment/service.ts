import type { Prisma } from "@/generated/prisma/client";
import { notFound, orNull, type CrmContext, type Page } from "@/modules/crm/context";
import { createStepInput, createProviderInput, type CreateStepInput } from "./schemas";
import { getDb } from "@/server/db/client";
import { assertCan, RuleViolationError } from "@/server/authz/guard";
import { auditData } from "@/server/audit/tx";
import { getProvider } from "./providers";
import {
  validateProviderConfig,
  canExecuteJob,
  computeJobProgress,
  canRollbackJob,
  type DeploymentJobStatus,
  type DeploymentStepStatus,
  type DeploymentProviderType,
  DEPLOYMENT_PROVIDER_TYPES,
  DEPLOYMENT_JOB_STATUSES,
} from "./rules";

// ---------------------------------------------------------------------------------------------
// Simple return types (avoiding Prisma.GetPayload which has TS6 issues)
// ---------------------------------------------------------------------------------------------

interface ProviderListItem {
  id: string;
  name: string;
  type: string;
  active: boolean;
  endpoint: string;
}

interface ProviderDetail {
  id: string;
  name: string;
  type: string;
  endpoint: string;
  config: unknown;
  active: boolean;
  customerId: string | null;
}

interface CredentialListItem {
  id: string;
  identifier: string;
  type: string;
  active: boolean;
}

interface DeploymentJobItem {
  id: string;
  number: string;
  providerId: string;
  customerId: string | null;
  projectId: string | null;
  title: string;
  description: string | null;
  status: DeploymentJobStatus;
  plan: unknown;
  rollbackPlan: unknown;
  approvedById: string | null;
  approvedAt: Date | null;
  rejectedById: string | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  idempotencyKey: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  provider: { id: string; name: string; type: string; endpoint: string } | null;
  customer: { id: string; name: string } | null;
  project: { id: string; title: string } | null;
  steps: Array<{
    id: string;
    jobId: string;
    position: number;
    kind: string;
    name: string;
    description: string | null;
    input: unknown;
    output: unknown;
    status: DeploymentStepStatus;
    errorMessage: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    retryCount: number;
    maxRetries: number;
    createdAt: Date;
    updatedAt: Date;
    logs: Array<{ id: string; level: string; message: string; metadata: unknown | null; createdAt: Date }>;
  }>;
  approvals: Array<{
    id: string;
    jobId: string;
    requiredBy: string;
    approvedById: string | null;
    approvedAt: Date | null;
    rejected: boolean;
    rejectedById: string | null;
    rejectedAt: Date | null;
    reason: string | null;
    createdAt: Date;
  }>;
  progress: number;
}

interface StepLogItem {
  id: string;
  level: string;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

// ---------------------------------------------------------------------------------------------
// Provider: reading (list/get)
// ---------------------------------------------------------------------------------------------

export async function listProviders(
  ctx: CrmContext,
  query: { type?: DeploymentProviderType; active?: boolean; customerId?: string; page?: number; pageSize?: number } = {},
): Promise<Page<ProviderListItem>> {
  assertCan(ctx.actor, "deployment:read");
  const { type, active, customerId, page = 1, pageSize = 20 } = query;

  const where: Prisma.DeploymentProviderWhereInput = {
    ...(type ? { type } : {}),
    ...(active !== undefined ? { active } : {}),
    ...(customerId ? { customerId } : {}),
  };

  const db = getDb();
  const [total, rows] = await Promise.all([
    db.deploymentProvider.count({ where }),
    db.deploymentProvider.findMany({
      where,
      include: { customer: { select: { name: true } } },
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    items: rows.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      active: p.active,
      endpoint: p.endpoint || "",
    })),
  };
}

export async function getProviderById(ctx: CrmContext, id: string): Promise<ProviderDetail> {
  assertCan(ctx.actor, "deployment:read");
  const db = getDb();
  const p = await db.deploymentProvider.findUnique({
    where: { id },
    include: { customer: true },
  });
  if (!p) throw notFound("Deployment provider");
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    endpoint: p.endpoint || "",
    config: p.config,
    active: p.active,
    customerId: p.customerId,
  };
}

// ---------------------------------------------------------------------------------------------
// Provider: writing (create/update/delete)
// ---------------------------------------------------------------------------------------------

export async function createProvider(ctx: CrmContext, input: { name: string; type: DeploymentProviderType; endpoint: string; config: Record<string, unknown>; customerId?: string }) {
  assertCan(ctx.actor, "deployment:write");
  const db = getDb();
  const parsed = createProviderInput.safeParse(input);
  if (!parsed.success) throw new RuleViolationError("VALIDATION", JSON.stringify(parsed.error.format()));

  const data = parsed.data;
  const provider = await db.deploymentProvider.create({
    data: {
      name: data.name,
      type: data.type,
      endpoint: data.endpoint,
      config: data.config as Prisma.InputJsonValue,
      customerId: data.customerId,
      active: true,
    },
  });

  await db.auditLog.create({
    data: auditData(
      ctx.actor,
      "deployment_provider.created" as const,
      "deployment_provider",
      provider.id,
      { name: data.name, type: data.type, customerId: data.customerId },
      ctx.client,
    ),
  });

  return { id: provider.id };
}

export async function updateProvider(ctx: CrmContext, id: string, input: { name?: string; active?: boolean }) {
  assertCan(ctx.actor, "deployment:write");
  const db = getDb();

  const p = await db.deploymentProvider.findUnique({ where: { id } });
  if (!p) throw notFound("Deployment provider");

  await db.deploymentProvider.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.active !== undefined && { active: input.active }),
    },
  });

  await db.auditLog.create({
    data: auditData(
      ctx.actor,
      "deployment_provider.updated" as const,
      "deployment_provider",
      id,
      { name: input.name, active: input.active },
      ctx.client,
    ),
  });

  return { id };
}

// ---------------------------------------------------------------------------------------------
// Credential: reading/listing
// ---------------------------------------------------------------------------------------------

export async function listCredentials(
  ctx: CrmContext,
  query: { providerId?: string; active?: boolean; page?: number; pageSize?: number } = {},
): Promise<Page<CredentialListItem>> {
  assertCan(ctx.actor, "deployment:read");
  const { providerId, active, page = 1, pageSize = 20 } = query;

  const where: Prisma.DeploymentCredentialWhereInput = {
    ...(providerId ? { providerId } : {}),
    ...(active !== undefined ? { active } : {}),
  };

  const db = getDb();
  const [total, rows] = await Promise.all([
    db.deploymentCredential.count({ where }),
    db.deploymentCredential.findMany({
      where,
      orderBy: { identifier: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    items: rows.map((c) => ({
      id: c.id,
      identifier: c.identifier,
      type: c.type,
      active: c.active,
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Job: reading/listing
// ---------------------------------------------------------------------------------------------

export async function listDeploymentJobs(
  ctx: CrmContext,
  query: {
    providerId?: string;
    customerId?: string;
    projectId?: string;
    status?: DeploymentJobStatus;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<Page<DeploymentJobItem>> {
  assertCan(ctx.actor, "deployment:read");
  const { providerId, customerId, projectId, status, page = 1, pageSize = 20 } = query;

  const where: Prisma.DeploymentJobWhereInput = {
    ...(providerId ? { providerId } : {}),
    ...(customerId ? { customerId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(status ? { status } : {}),
  };

  const db = getDb();
  const [total, rows] = await Promise.all([
    db.deploymentJob.count({ where }),
    db.deploymentJob.findMany({
      where,
      include: {
        provider: true,
        customer: true,
        project: true,
        steps: { include: { logs: true } },
        approvals: { include: { approvedBy: true, rejectedBy: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    items: rows.map((j): DeploymentJobItem => ({
      id: j.id,
      number: j.number,
      providerId: j.providerId,
      customerId: j.customerId,
      projectId: j.projectId,
      title: j.title,
      description: j.description,
      status: j.status as DeploymentJobStatus,
      plan: j.plan,
      rollbackPlan: j.rollbackPlan,
      approvedById: j.approvedById,
      approvedAt: j.approvedAt,
      rejectedById: j.rejectedById,
      rejectedAt: j.rejectedAt,
      rejectionReason: j.rejectionReason,
      startedAt: j.startedAt,
      completedAt: j.completedAt,
      errorMessage: j.errorMessage,
      idempotencyKey: j.idempotencyKey,
      createdById: j.createdById,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      provider: j.provider ? { id: j.provider.id, name: j.provider.name, type: j.provider.type, endpoint: j.provider.endpoint } : null,
      customer: j.customer ? { id: j.customer.id, name: j.customer.name } : null,
      project: j.project ? { id: j.project.id, title: j.project.title } : null,
      steps: j.steps.map((s) => ({
        id: s.id,
        jobId: s.jobId,
        position: s.position,
        kind: s.kind,
        name: s.name,
        description: s.description ?? null,
        input: s.input,
        output: s.output,
        status: s.status as DeploymentStepStatus,
        errorMessage: s.errorMessage,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        retryCount: s.retryCount,
        maxRetries: s.maxRetries,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        logs: s.logs.map((l) => ({
          id: l.id,
          level: l.level,
          message: l.message,
          metadata: l.metadata ?? null,
          createdAt: l.createdAt,
        })),
      })),
      approvals: j.approvals.map((a) => ({
        id: a.id,
        jobId: a.jobId,
        requiredBy: a.requiredBy,
        approvedById: a.approvedById,
        approvedAt: a.approvedAt,
        rejected: a.rejected,
        rejectedById: a.rejectedById,
        rejectedAt: a.rejectedAt,
        reason: a.reason,
        createdAt: a.createdAt,
      })),
      progress: computeJobProgress(j.steps.map((s) => ({ status: s.status as DeploymentStepStatus }))),
    })),
  };
}

export async function getDeploymentJob(ctx: CrmContext, id: string): Promise<DeploymentJobItem> {
  assertCan(ctx.actor, "deployment:read");
  const db = getDb();
  const j = await db.deploymentJob.findUnique({
    where: { id },
    include: {
      provider: true,
      customer: true,
      project: true,
      steps: { include: { logs: true } },
      approvals: { include: { approvedBy: true, rejectedBy: true } },
    },
  });
  if (!j) throw notFound("Deployment job");
  return {
    id: j.id,
    number: j.number,
    providerId: j.providerId,
    customerId: j.customerId,
    projectId: j.projectId,
    title: j.title,
    description: j.description,
    status: j.status as DeploymentJobStatus,
    plan: j.plan,
    rollbackPlan: j.rollbackPlan,
    approvedById: j.approvedById,
    approvedAt: j.approvedAt,
    rejectedById: j.rejectedById,
    rejectedAt: j.rejectedAt,
    rejectionReason: j.rejectionReason,
    startedAt: j.startedAt,
    completedAt: j.completedAt,
    errorMessage: j.errorMessage,
    idempotencyKey: j.idempotencyKey,
    createdById: j.createdById,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    provider: j.provider ? { id: j.provider.id, name: j.provider.name, type: j.provider.type, endpoint: j.provider.endpoint } : null,
    customer: j.customer ? { id: j.customer.id, name: j.customer.name } : null,
    project: j.project ? { id: j.project.id, title: j.project.title } : null,
    steps: j.steps.map((s) => ({
      id: s.id,
      jobId: s.jobId,
      position: s.position,
      kind: s.kind,
      name: s.name,
      description: s.description ?? null,
      input: s.input,
      output: s.output,
      status: s.status as DeploymentStepStatus,
      errorMessage: s.errorMessage,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      retryCount: s.retryCount,
      maxRetries: s.maxRetries,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      logs: s.logs.map((l) => ({
        id: l.id,
        level: l.level,
        message: l.message,
        metadata: l.metadata ?? null,
        createdAt: l.createdAt,
      })),
    })),
    approvals: j.approvals.map((a) => ({
      id: a.id,
      jobId: a.jobId,
      requiredBy: a.requiredBy,
      approvedById: a.approvedById,
      approvedAt: a.approvedAt,
      rejected: a.rejected,
      rejectedById: a.rejectedById,
      rejectedAt: a.rejectedAt,
      reason: a.reason,
      createdAt: a.createdAt,
    })),
    progress: computeJobProgress(j.steps.map((s) => ({ status: s.status as DeploymentStepStatus }))),
  };
}

// ---------------------------------------------------------------------------------------------
// Job: approval workflow
// ---------------------------------------------------------------------------------------------

export async function approveJob(ctx: CrmContext, id: string) {
  assertCan(ctx.actor, "deployment:approve");
  const db = getDb();

  const job = await db.deploymentJob.findUnique({ where: { id } });
  if (!job) throw notFound("Deployment job");
  if (job.status !== "pending_approval") {
    throw new RuleViolationError("JOB_WRONG_STATUS", `Job is in "${job.status}" status, cannot approve`);
  }

  await db.deploymentJob.update({
    where: { id },
    data: { status: "approved", approvedById: ctx.actor.id, approvedAt: new Date() },
  });

  await db.auditLog.create({
    data: auditData(
      ctx.actor,
      "deployment_job.approved" as const,
      "deployment_job",
      id,
      {},
      ctx.client,
    ),
  });

  return { id };
}

export async function rejectJob(ctx: CrmContext, id: string, reason: string) {
  assertCan(ctx.actor, "deployment:approve");
  const db = getDb();

  const job = await db.deploymentJob.findUnique({ where: { id } });
  if (!job) throw notFound("Deployment job");

  await db.deploymentJob.update({
    where: { id },
    data: { status: "rejected", rejectedById: ctx.actor.id, rejectedAt: new Date(), rejectionReason: reason },
  });

  await db.auditLog.create({
    data: auditData(
      ctx.actor,
      "deployment_job.rejected" as const,
      "deployment_job",
      id,
      { reason },
      ctx.client,
    ),
  });

  return { id };
}

// ---------------------------------------------------------------------------------------------
// Job: execution (trigger worker)
// ---------------------------------------------------------------------------------------------

export async function executeJob(ctx: CrmContext, id: string) {
  assertCan(ctx.actor, "deployment:execute");
  const db = getDb();

  const job = await db.deploymentJob.findUnique({ where: { id } });
  if (!job) throw notFound("Deployment job");

  if (job.status !== "approved") {
    throw new RuleViolationError("JOB_NOT_APPROVED", `Job must be approved before execution. Current status: ${job.status}`);
  }

  await db.deploymentJob.update({
    where: { id },
    data: { status: "executing", startedAt: new Date() },
  });

  await db.auditLog.create({
    data: auditData(
      ctx.actor,
      "deployment_job.executed" as const,
      "deployment_job",
      id,
      {},
      ctx.client,
    ),
  });

  await db.auditLog.create({
    data: auditData(
      ctx.actor,
      "deployment_job.worker_triggered" as const,
      "deployment_job",
      id,
      { trigger: "server_action" },
      ctx.client,
    ),
  });

  return {
    id,
    status: "executing",
    message: "Job execution triggered. Worker will process steps. Check deployment status for progress.",
  };
}

// ---------------------------------------------------------------------------------------------
// Job: rollback
// ---------------------------------------------------------------------------------------------

export async function rollbackJob(ctx: CrmContext, id: string) {
  assertCan(ctx.actor, "deployment:execute");
  const db = getDb();

  const job = await db.deploymentJob.findUnique({ where: { id } });
  if (!job) throw notFound("Deployment job");

  if (!canRollbackJob(job.status as DeploymentJobStatus)) {
    throw new RuleViolationError("JOB_CANNOT_ROLLBACK", `Job cannot be rolled back in "${job.status}" status`);
  }

  await db.deploymentJob.update({
    where: { id },
    data: { status: "rolling_back", startedAt: new Date() },
  });

  await db.auditLog.create({
    data: auditData(
      ctx.actor,
      "deployment_job.rollback_started" as const,
      "deployment_job",
      id,
      {},
      ctx.client,
    ),
  });

  return {
    id,
    status: "rolling_back",
    message: "Job rollback initiated. Worker will execute rollback steps.",
  };
}

// ---------------------------------------------------------------------------------------------
// Step: create/update
// ---------------------------------------------------------------------------------------------

export async function createStep(ctx: CrmContext, input: CreateStepInput) {
  assertCan(ctx.actor, "deployment:write");
  const parsed = createStepInput.safeParse(input);
  if (!parsed.success) throw new RuleViolationError("VALIDATION", JSON.stringify(parsed.error.format()));

  const data = parsed.data;
  const db = getDb();

  const job = await db.deploymentJob.findUnique({ where: { id: data.jobId } });
  if (!job) throw notFound("Deployment job");

  const provider = await db.deploymentProvider.findUnique({ where: { id: job.providerId } });
  if (!provider) throw new RuleViolationError("PROVIDER_NOT_FOUND", "Provider not found for this job");

  const configErrors = validateProviderConfig(provider.type, provider.config as Record<string, unknown>);
  if (configErrors.length > 0) {
    throw new RuleViolationError("PROVIDER_CONFIG_INVALID", `Provider config errors: ${configErrors.join(", ")}`);
  }

  const step = await db.deploymentStep.create({
    data: {
      jobId: data.jobId,
      position: data.position,
      kind: data.kind,
      name: data.name,
      description: data.description,
      input: data.input as Prisma.InputJsonValue ?? null,
      maxRetries: data.maxRetries,
    },
  });

  await db.deploymentLog.create({
    data: {
      stepId: step.id,
      level: "info",
      message: `Step created: ${step.name}`,
      metadata: { kind: step.kind, position: step.position, jobId: data.jobId },
    },
  });

  return { id: step.id };
}

export async function updateStep(ctx: CrmContext, id: string, input: { name?: string; description?: string; input?: Record<string, unknown>; maxRetries?: number }) {
  assertCan(ctx.actor, "deployment:write");
  const db = getDb();

  const step = await db.deploymentStep.findUnique({ where: { id } });
  if (!step) throw notFound("Deployment step");

  await db.deploymentStep.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.input !== undefined && { input: input.input as Prisma.InputJsonValue }),
      ...(input.maxRetries !== undefined && { maxRetries: input.maxRetries }),
    },
  });

  return { id };
}

// ---------------------------------------------------------------------------------------------
// Step: logs
// ---------------------------------------------------------------------------------------------

export async function listStepLogs(
  ctx: CrmContext,
  stepId: string,
  query: { page?: number; pageSize?: number } = {},
): Promise<{ total: number; page: number; pageSize: number; items: StepLogItem[] }> {
  assertCan(ctx.actor, "deployment:read");
  const { page = 1, pageSize = 50 } = query;

  const db = getDb();
  const [total, rows] = await Promise.all([
    db.deploymentLog.count({ where: { stepId } }),
    db.deploymentLog.findMany({
      where: { stepId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    items: rows.map((l) => ({
      id: l.id,
      level: l.level,
      message: l.message,
      metadata: (l.metadata as Record<string, unknown>) ?? undefined,
      createdAt: l.createdAt,
    })),
  };
}