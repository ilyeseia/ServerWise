/**
 * Deployment Automation rules — pure functions for state machines and validation.
 * No I/O, no clock: callers pass `now`, so every rule is deterministic and unit-tested.
 */

export const DEPLOYMENT_PROVIDER_TYPES = [
  "proxmox",
  "ssh_ansible",
  "docker_engine",
  "docker_compose",
  "nas_generic",
  "custom",
] as const;
export type DeploymentProviderType = (typeof DEPLOYMENT_PROVIDER_TYPES)[number];

export const DEPLOYMENT_CREDENTIAL_TYPES = [
  "api_token",
  "ssh_key",
  "username_password",
  "oauth_token",
  "custom",
] as const;
export type DeploymentCredentialType = (typeof DEPLOYMENT_CREDENTIAL_TYPES)[number];

export const DEPLOYMENT_JOB_STATUSES = [
  "pending_approval",
  "approved",
  "rejected",
  "planned",
  "executing",
  "completed",
  "failed",
  "cancelled",
  "rolling_back",
  "rolled_back",
] as const;
export type DeploymentJobStatus = (typeof DEPLOYMENT_JOB_STATUSES)[number];

export const DEPLOYMENT_STEP_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
  "rolled_back",
] as const;
export type DeploymentStepStatus = (typeof DEPLOYMENT_STEP_STATUSES)[number];

export const DEPLOYMENT_STEP_KINDS = [
  "validation",
  "provisioning",
  "configuration",
  "verification",
  "rollback",
  "custom",
] as const;
export type DeploymentStepKind = (typeof DEPLOYMENT_STEP_KINDS)[number];

/**
 * State machine for DeploymentJob.
 * pending_approval → approved → planned → executing → completed
 *                    ↘ rejected
 *                    ↘ cancelled
 * executing → failed → rolling_back → rolled_back
 * executing → cancelled
 */
const JOB_TRANSITIONS: Record<DeploymentJobStatus, readonly DeploymentJobStatus[]> = {
  pending_approval: ["approved", "rejected", "cancelled"],
  approved: ["planned", "cancelled"],
  rejected: [],
  planned: ["executing", "cancelled"],
  executing: ["completed", "failed", "cancelled"],
  completed: [],
  failed: ["rolling_back", "cancelled"],
  cancelled: [],
  rolling_back: ["rolled_back"],
  rolled_back: [],
};

export const allowedNextJobStatuses = (from: DeploymentJobStatus) =>
  JOB_TRANSITIONS[from];

export const canTransitionJob = (
  from: DeploymentJobStatus,
  to: DeploymentJobStatus,
) => JOB_TRANSITIONS[from].includes(to);

/**
 * State machine for DeploymentStep.
 * pending → running → completed
 *           ↘ failed → (retry) → running
 *           ↘ skipped
 * completed → rolled_back (during rollback)
 */
const STEP_TRANSITIONS: Record<DeploymentStepStatus, readonly DeploymentStepStatus[]> = {
  pending: ["running", "skipped"],
  running: ["completed", "failed"],
  completed: ["rolled_back"],
  failed: ["running", "skipped"], // retry or skip
  skipped: [],
  rolled_back: [],
};

export const allowedNextStepStatuses = (from: DeploymentStepStatus) =>
  STEP_TRANSITIONS[from];

export const canTransitionStep = (
  from: DeploymentStepStatus,
  to: DeploymentStepStatus,
) => STEP_TRANSITIONS[from].includes(to);

/**
 * Validate provider configuration based on type.
 * Returns array of validation errors (empty = valid).
 */
export interface ProviderConfig {
  [key: string]: unknown;
}

export function validateProviderConfig(
  type: DeploymentProviderType,
  config: ProviderConfig,
): string[] {
  const errors: string[] = [];

  switch (type) {
    case "proxmox": {
      if (!config.node || typeof config.node !== "string") {
        errors.push("Proxmox: 'node' (target node name) is required");
      }
      if (!config.storage || typeof config.storage !== "string") {
        errors.push("Proxmox: 'storage' (target storage name) is required");
      }
      if (!config.network || typeof config.network !== "string") {
        errors.push("Proxmox: 'network' (bridge name, e.g., vmbr0) is required");
      }
      break;
    }
    case "ssh_ansible": {
      if (!config.host || typeof config.host !== "string") {
        errors.push("SSH/Ansible: 'host' is required");
      }
      if (!config.user || typeof config.user !== "string") {
        errors.push("SSH/Ansible: 'user' is required");
      }
      if (!config.playbookPath || typeof config.playbookPath !== "string") {
        errors.push("SSH/Ansible: 'playbookPath' is required");
      }
      if (config.become !== undefined && typeof config.become !== "boolean") {
        errors.push("SSH/Ansible: 'become' must be boolean");
      }
      break;
    }
    case "docker_engine": {
      if (!config.host || typeof config.host !== "string") {
        errors.push("Docker Engine: 'host' (e.g., tcp://host:2376 or unix:///var/run/docker.sock) is required");
      }
      if (!config.stackName || typeof config.stackName !== "string") {
        errors.push("Docker Engine: 'stackName' is required");
      }
      break;
    }
    case "docker_compose": {
      if (!config.projectPath || typeof config.projectPath !== "string") {
        errors.push("Docker Compose: 'projectPath' is required");
      }
      if (!config.stackName || typeof config.stackName !== "string") {
        errors.push("Docker Compose: 'stackName' is required");
      }
      break;
    }
    case "nas_generic": {
      if (!config.apiUrl || typeof config.apiUrl !== "string") {
        errors.push("NAS Generic: 'apiUrl' is required");
      }
      if (!config.volumePath || typeof config.volumePath !== "string") {
        errors.push("NAS Generic: 'volumePath' is required");
      }
      break;
    }
    case "custom": {
      // Custom providers validate their own config
      break;
    }
  }

  return errors;
}

/**
 * Validate deployment job input before creating.
 */
export interface JobInputValidation {
  title: string;
  description?: string;
  providerId: string;
  customerId?: string;
  projectId?: string;
}

export function validateJobInput(input: JobInputValidation): string[] {
  const errors: string[] = [];

  if (!input.title?.trim()) {
    errors.push("Title is required");
  }
  if (input.title && input.title.length > 300) {
    errors.push("Title must be 300 characters or less");
  }
  if (input.description && input.description.length > 4000) {
    errors.push("Description must be 4000 characters or less");
  }
  if (!input.providerId?.trim()) {
    errors.push("Provider is required");
  }

  return errors;
}

/**
 * Validate step input based on kind.
 */
export interface StepInput {
  kind: DeploymentStepKind;
  name: string;
  input?: Record<string, unknown>;
  maxRetries?: number;
}

export function validateStepInput(step: StepInput): string[] {
  const errors: string[] = [];

  if (!step.name?.trim()) {
    errors.push("Step name is required");
  }
  if (step.name && step.name.length > 200) {
    errors.push("Step name must be 200 characters or less");
  }
  if (step.maxRetries !== undefined) {
    if (!Number.isInteger(step.maxRetries) || step.maxRetries < 0 || step.maxRetries > 10) {
      errors.push("maxRetries must be an integer between 0 and 10");
    }
  }

  // Kind-specific validation
  switch (step.kind) {
    case "validation":
      // Validation steps typically just check connectivity/prerequisites
      break;
    case "provisioning":
      // Should have target resource specs in input
      break;
    case "configuration":
      // Should have config parameters in input
      break;
    case "verification":
      // Should have verification criteria in input
      break;
    case "rollback":
      // Should reference the step to rollback
      break;
    case "custom":
      break;
  }

  return errors;
}

/**
 * Execution plan structure (what the provider plans to do).
 */
export interface ExecutionPlan {
  version: number;
  providerType: DeploymentProviderType;
  steps: Array<{
    position: number;
    kind: DeploymentStepKind;
    name: string;
    description?: string;
    input: Record<string, unknown>;
    estimatedDurationSeconds?: number;
  }>;
  rollbackSteps: Array<{
    position: number;
    kind: DeploymentStepKind;
    name: string;
    description?: string;
    input: Record<string, unknown>;
    referencesStepPosition: number; // which forward step this rolls back
  }>;
  metadata?: Record<string, unknown>;
}

/**
 * Validate execution plan structure.
 */
export function validateExecutionPlan(plan: ExecutionPlan): string[] {
  const errors: string[] = [];

  if (!plan.version || plan.version < 1) {
    errors.push("Plan version must be >= 1");
  }
  if (!DEPLOYMENT_PROVIDER_TYPES.includes(plan.providerType)) {
    errors.push(`Invalid provider type: ${plan.providerType}`);
  }
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    errors.push("Plan must have at least one step");
  }
  if (!Array.isArray(plan.rollbackSteps)) {
    errors.push("Plan must have rollbackSteps array (can be empty)");
  }

  // Check step positions are sequential
  plan.steps.forEach((step, idx) => {
    if (step.position !== idx) {
      errors.push(`Step at index ${idx} has position ${step.position}, expected ${idx}`);
    }
    if (!DEPLOYMENT_STEP_KINDS.includes(step.kind)) {
      errors.push(`Step ${step.position}: invalid kind ${step.kind}`);
    }
    if (!step.name?.trim()) {
      errors.push(`Step ${step.position}: name is required`);
    }
  });

  // Check rollback steps reference valid forward steps
  plan.rollbackSteps.forEach((rb, idx) => {
    if (rb.position !== idx) {
      errors.push(`Rollback step at index ${idx} has position ${rb.position}, expected ${idx}`);
    }
    if (rb.referencesStepPosition < 0 || rb.referencesStepPosition >= plan.steps.length) {
      errors.push(`Rollback step ${rb.position}: referencesStepPosition ${rb.referencesStepPosition} out of range`);
    }
  });

  return errors;
}

/**
 * Check if a job can be executed (all approvals granted).
 */
export function canExecuteJob(
  status: DeploymentJobStatus,
  approvals: Array<{ requiredBy: string; approvedAt: Date | null; rejected: boolean }>,
): boolean {
  if (status !== "planned") return false;
  if (approvals.some((a) => a.rejected)) return false;
  return approvals.every((a) => a.approvedAt !== null);
}

/**
 * Compute job progress percentage.
 */
export function computeJobProgress(
  steps: Array<{ status: DeploymentStepStatus }>,
): number {
  if (steps.length === 0) return 0;
  const completed = steps.filter((s) => s.status === "completed").length;
  const rolledBack = steps.filter((s) => s.status === "rolled_back").length;
  return Math.round(((completed + rolledBack) / steps.length) * 100);
}

/**
 * Check if a rollback is possible for a job.
 */
export function canRollbackJob(status: DeploymentJobStatus): boolean {
  return ["failed", "executing"].includes(status);
}