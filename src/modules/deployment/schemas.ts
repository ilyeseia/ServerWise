/**
 * Zod schemas for Deployment Automation module.
 * Input validation for server actions and API routes.
 */

import { z } from "zod";
import {
  DEPLOYMENT_PROVIDER_TYPES,
  DEPLOYMENT_CREDENTIAL_TYPES,
  DEPLOYMENT_JOB_STATUSES,
  DEPLOYMENT_STEP_KINDS,
} from "./rules";

type DeploymentProviderType = (typeof DEPLOYMENT_PROVIDER_TYPES)[number];
type DeploymentCredentialType = (typeof DEPLOYMENT_CREDENTIAL_TYPES)[number];
type DeploymentJobStatus = (typeof DEPLOYMENT_JOB_STATUSES)[number];
type DeploymentStepKind = (typeof DEPLOYMENT_STEP_KINDS)[number];

// ---------------------------------------------------------------------------------------------
// Provider schemas
// ---------------------------------------------------------------------------------------------

export const providerConfigSchema = z.record(z.string(), z.unknown());

export const createProviderInput = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(DEPLOYMENT_PROVIDER_TYPES),
  endpoint: z.string().url().max(500),
  config: providerConfigSchema,
  customerId: z.string().uuid().optional(),
});

export const updateProviderInput = createProviderInput.partial().extend({
  active: z.boolean().optional(),
});

export type CreateProviderInput = z.infer<typeof createProviderInput>;
export type UpdateProviderInput = z.infer<typeof updateProviderInput>;

// ---------------------------------------------------------------------------------------------
// Credential schemas
// ---------------------------------------------------------------------------------------------

export const createCredentialInput = z.object({
  providerId: z.string().uuid(),
  type: z.enum(DEPLOYMENT_CREDENTIAL_TYPES),
  identifier: z.string().min(1).max(100),
  secretRef: z.string().min(1).max(500),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateCredentialInput = createCredentialInput.partial().extend({
  active: z.boolean().optional(),
});

export type CreateCredentialInput = z.infer<typeof createCredentialInput>;
export type UpdateCredentialInput = z.infer<typeof updateCredentialInput>;

// ---------------------------------------------------------------------------------------------
// Job schemas
// ---------------------------------------------------------------------------------------------

export const createJobInput = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(4000).optional(),
  providerId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  idempotencyKey: z.string().max(100).optional(),
});

export const updateJobInput = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(4000).optional(),
});

export const approveJobInput = z.object({
  jobId: z.string().uuid(),
});

export const rejectJobInput = z.object({
  jobId: z.string().uuid(),
  reason: z.string().min(1).max(1000),
});

export const executeJobInput = z.object({
  jobId: z.string().uuid(),
});

export const cancelJobInput = z.object({
  jobId: z.string().uuid(),
});

export const rollbackJobInput = z.object({
  jobId: z.string().uuid(),
});

export type CreateJobInput = z.infer<typeof createJobInput>;
export type UpdateJobInput = z.infer<typeof updateJobInput>;
export type ApproveJobInput = z.infer<typeof approveJobInput>;
export type RejectJobInput = z.infer<typeof rejectJobInput>;
export type ExecuteJobInput = z.infer<typeof executeJobInput>;
export type CancelJobInput = z.infer<typeof cancelJobInput>;
export type RollbackJobInput = z.infer<typeof rollbackJobInput>;

// ---------------------------------------------------------------------------------------------
// Step schemas
// ---------------------------------------------------------------------------------------------

export const createStepInput = z.object({
  jobId: z.string().uuid(),
  position: z.number().int().min(0),
  kind: z.enum(DEPLOYMENT_STEP_KINDS),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  maxRetries: z.number().int().min(0).max(10).default(0),
});

export const updateStepInput = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
});

export type CreateStepInput = z.infer<typeof createStepInput>;
export type UpdateStepInput = z.infer<typeof updateStepInput>;

// ---------------------------------------------------------------------------------------------
// Plan schemas
// ---------------------------------------------------------------------------------------------

export const executionPlanSchema = z.object({
  version: z.number().int().min(1),
  providerType: z.enum(DEPLOYMENT_PROVIDER_TYPES),
  steps: z.array(z.object({
    position: z.number().int().min(0),
    kind: z.enum(DEPLOYMENT_STEP_KINDS),
    name: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    input: z.record(z.string(), z.unknown()),
    estimatedDurationSeconds: z.number().int().min(0).optional(),
  })),
  rollbackSteps: z.array(z.object({
    position: z.number().int().min(0),
    kind: z.enum(DEPLOYMENT_STEP_KINDS),
    name: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    input: z.record(z.string(), z.unknown()),
    referencesStepPosition: z.number().int().min(0),
  })),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ExecutionPlanInput = z.infer<typeof executionPlanSchema>;

// ---------------------------------------------------------------------------------------------
// Approval schemas
// ---------------------------------------------------------------------------------------------

export const createApprovalInput = z.object({
  jobId: z.string().uuid(),
  requiredBy: z.string().min(1).max(100),
});

export const approveInput = z.object({
  approvalId: z.string().uuid(),
});

export const rejectApprovalInput = z.object({
  approvalId: z.string().uuid(),
  reason: z.string().min(1).max(500),
});

export type CreateApprovalInput = z.infer<typeof createApprovalInput>;
export type ApproveInput = z.infer<typeof approveInput>;
export type RejectApprovalInput = z.infer<typeof rejectApprovalInput>;

// ---------------------------------------------------------------------------------------------
// Query/List schemas
// ---------------------------------------------------------------------------------------------

export const deploymentJobListQuery = z.object({
  providerId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  status: z.enum(DEPLOYMENT_JOB_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const providerListQuery = z.object({
  type: z.enum(DEPLOYMENT_PROVIDER_TYPES).optional(),
  active: z.coerce.boolean().optional(),
  customerId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const credentialListQuery = z.object({
  providerId: z.string().uuid().optional(),
  active: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type DeploymentJobListQuery = z.infer<typeof deploymentJobListQuery>;
export type ProviderListQuery = z.infer<typeof providerListQuery>;
export type CredentialListQuery = z.infer<typeof credentialListQuery>;

// ---------------------------------------------------------------------------------------------
// DeploymentLog schema
// ---------------------------------------------------------------------------------------------

export const deploymentLogInput = z.object({
  stepId: z.string().uuid(),
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string().min(1).max(4000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type DeploymentLog = z.infer<typeof deploymentLogInput>;