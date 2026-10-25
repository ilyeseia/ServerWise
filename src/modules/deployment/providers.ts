/**
 * Deployment Provider Interface and Mock Implementations.
 *
 * This defines the contract that all deployment providers must implement.
 * Real implementations (Stage 13) will replace the mocks.
 */

import type {
  DeploymentProviderType,
  DeploymentStepKind,
  ExecutionPlan,
  ProviderConfig,
} from "./rules";
import {
  validateProviderConfig,
  validateExecutionPlan,
} from "./rules";
import { RealProxmoxProvider } from "./providers/realProxmox";
import { RealSshAnsibleProvider } from "./providers/realSshAnsible";
import { RealDockerEngineProvider } from "./providers/realDockerEngine";
import { RealDockerComposeProvider } from "./providers/realDockerCompose";
import { RealNasGenericProvider } from "./providers/realNasGeneric";

/**
 * Provider execution context - passed to all provider methods.
 */
export interface ProviderContext {
  /** The provider configuration from the database */
  providerConfig: ProviderConfig;
  /** Resolved credentials (secrets) for this execution */
  credentials: Record<string, string>;
  /** Job-specific parameters */
  jobParams: Record<string, unknown>;
  /** Step-specific parameters */
  stepParams?: Record<string, unknown>;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Logger function */
  log: (level: "debug" | "info" | "warn" | "error", message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Result of a provider operation.
 */
export interface ProviderResult<T = unknown> {
  success: boolean;
  output?: T;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Core interface that all deployment providers must implement.
 */
export interface DeploymentProvider {
  /** Unique provider type identifier */
  readonly type: DeploymentProviderType;

  /** Human-readable name */
  readonly name: string;

  /** Validate provider configuration */
  validateConfig(config: ProviderConfig): string[];

  /**
   * Generate an execution plan for a job.
   * Called before job approval - the plan is reviewed by humans.
   */
  plan(context: ProviderContext): Promise<ProviderResult<ExecutionPlan>>;

  /**
   * Execute a single step.
   * Returns output that becomes the step's output in the database.
   */
  executeStep(
    context: ProviderContext,
    step: { kind: DeploymentStepKind; name: string; input: Record<string, unknown> },
  ): Promise<ProviderResult>;

  /**
   * Execute a rollback step.
   * Called during job rollback to undo a specific forward step.
   */
  executeRollback(
    context: ProviderContext,
    step: { kind: DeploymentStepKind; name: string; input: Record<string, unknown> },
    forwardStepOutput: Record<string, unknown>,
  ): Promise<ProviderResult>;

  /**
   * Verify the result of a completed job.
   * Called after all steps complete to confirm desired state.
   */
  verify(context: ProviderContext, plan: ExecutionPlan): Promise<ProviderResult>;

  /**
   * Get provider-specific health/status info.
   * Used for monitoring and dashboards.
   */
  healthCheck(context: ProviderContext): Promise<ProviderResult<{ healthy: boolean; details: Record<string, unknown> }>>;
}

/**
 * Base class with common functionality for providers.
 */
export abstract class BaseProvider implements DeploymentProvider {
  abstract readonly type: DeploymentProviderType;
  abstract readonly name: string;

  validateConfig(config: ProviderConfig): string[] {
    return validateProviderConfig(this.type, config);
  }

  abstract plan(context: ProviderContext): Promise<ProviderResult<ExecutionPlan>>;

  abstract executeStep(
    context: ProviderContext,
    step: { kind: DeploymentStepKind; name: string; input: Record<string, unknown> },
  ): Promise<ProviderResult>;

  abstract executeRollback(
    context: ProviderContext,
    step: { kind: DeploymentStepKind; name: string; input: Record<string, unknown> },
    forwardStepOutput: Record<string, unknown>,
  ): Promise<ProviderResult>;

  abstract verify(context: ProviderContext, plan: ExecutionPlan): Promise<ProviderResult>;

  async healthCheck(context: ProviderContext): Promise<ProviderResult<{ healthy: boolean; details: Record<string, unknown> }>> {
    return { success: true, output: { healthy: true, details: { message: "Mock health check passed" } } };
  }

  protected log(context: ProviderContext, level: "debug" | "info" | "warn" | "error", message: string, meta?: Record<string, unknown>) {
    context.log(level, `[${this.type}] ${message}`, meta);
  }

  protected success<T>(output: T, metadata?: Record<string, unknown>): ProviderResult<T> {
    return { success: true, output, metadata };
  }

  protected failure<T = unknown>(error: string, metadata?: Record<string, unknown>): ProviderResult<T> {
    return { success: false, error, metadata };
  }
}

/**
 * Mock Proxmox Provider - simulates Proxmox VE API operations.
 * Replace with real implementation in Stage 13.
 */
export class MockProxmoxProvider extends BaseProvider {
  readonly type = "proxmox" as const;
  readonly name = "Proxmox VE (Mock)";

  async plan(context: ProviderContext): Promise<ProviderResult<ExecutionPlan>> {
    this.log(context, "info", "Generating mock Proxmox execution plan");

    const plan: ExecutionPlan = {
      version: 1,
      providerType: this.type,
      steps: [
        {
          position: 0,
          kind: "validation",
          name: "Validate Proxmox connection",
          description: "Check API connectivity and permissions",
          input: { action: "test_connection" },
          estimatedDurationSeconds: 10,
        },
        {
          position: 1,
          kind: "provisioning",
          name: "Create VM",
          description: "Provision new virtual machine",
          input: {
            action: "create_vm",
            vmid: 100,
            name: context.jobParams.vmName || "serverwise-vm",
            cores: context.jobParams.cores || 2,
            memory: context.jobParams.memory || 4096,
            disk: context.jobParams.disk || "32G",
            storage: context.providerConfig.storage,
            network: context.providerConfig.network,
          },
          estimatedDurationSeconds: 60,
        },
        {
          position: 2,
          kind: "configuration",
          name: "Configure VM network",
          description: "Set static IP, DNS, hostname",
          input: {
            action: "configure_network",
            ip: context.jobParams.ipAddress,
            gateway: context.jobParams.gateway,
            dns: context.jobParams.dns,
          },
          estimatedDurationSeconds: 15,
        },
        {
          position: 3,
          kind: "verification",
          name: "Verify VM is running",
          description: "Check VM status and network connectivity",
          input: { action: "verify_vm" },
          estimatedDurationSeconds: 30,
        },
      ],
      rollbackSteps: [
        {
          position: 0,
          kind: "rollback",
          name: "Delete VM on failure",
          description: "Remove the created VM if deployment fails",
          input: { action: "delete_vm", vmid: 100 },
          referencesStepPosition: 1,
        },
      ],
      metadata: { node: context.providerConfig.node },
    };

    const validationErrors = validateExecutionPlan(plan);
    if (validationErrors.length > 0) {
      return this.failure("Invalid plan generated", { errors: validationErrors });
    }

    return this.success(plan);
  }

  async executeStep(
    context: ProviderContext,
    step: { kind: DeploymentStepKind; name: string; input: Record<string, unknown> },
  ): Promise<ProviderResult> {
    this.log(context, "info", `Executing mock step: ${step.name}`, { kind: step.kind, input: step.input });

    // Simulate execution delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Mock responses based on step kind
    switch (step.kind) {
      case "validation":
        return this.success({ connected: true, version: "8.2.4", node: context.providerConfig.node });
      case "provisioning":
        return this.success({ vmid: 100, status: "created", taskId: "UPID:node:00012345:00000001:..." });
      case "configuration":
        return this.success({ configured: true, ip: step.input.ip });
      case "verification":
        return this.success({ running: true, ip: context.jobParams.ipAddress, ping: "ok" });
      default:
        return this.success({ completed: true });
    }
  }

  async executeRollback(
    context: ProviderContext,
    step: { kind: DeploymentStepKind; name: string; input: Record<string, unknown> },
    forwardStepOutput: Record<string, unknown>,
  ): Promise<ProviderResult> {
    this.log(context, "warn", `Executing mock rollback: ${step.name}`, { input: step.input, forwardOutput: forwardStepOutput });

    await new Promise((resolve) => setTimeout(resolve, 100));

    return this.success({ rolledBack: true, deletedVmid: forwardStepOutput.vmid });
  }

  async verify(context: ProviderContext, plan: ExecutionPlan): Promise<ProviderResult> {
    this.log(context, "info", "Verifying mock Proxmox deployment");
    return this.success({ verified: true, vmStatus: "running" });
  }
}

/**
 * Mock SSH/Ansible Provider - simulates SSH and Ansible operations.
 * Replace with real implementation in Stage 13.
 */
export class MockSshAnsibleProvider extends BaseProvider {
  readonly type = "ssh_ansible" as const;
  readonly name = "SSH/Ansible (Mock)";

  async plan(context: ProviderContext): Promise<ProviderResult<ExecutionPlan>> {
    this.log(context, "info", "Generating mock SSH/Ansible execution plan");

    const plan: ExecutionPlan = {
      version: 1,
      providerType: this.type,
      steps: [
        {
          position: 0,
          kind: "validation",
          name: "Test SSH connectivity",
          description: "Verify SSH access and sudo privileges",
          input: { action: "test_ssh", host: context.providerConfig.host, user: context.providerConfig.user },
          estimatedDurationSeconds: 10,
        },
        {
          position: 1,
          kind: "provisioning",
          name: "Run Ansible playbook",
          description: "Execute provisioning playbook",
          input: {
            action: "run_playbook",
            playbook: context.providerConfig.playbookPath,
            inventory: context.providerConfig.host,
            extraVars: context.jobParams.extraVars || {},
            become: context.providerConfig.become || true,
          },
          estimatedDurationSeconds: 180,
        },
        {
          position: 2,
          kind: "verification",
          name: "Verify deployment",
          description: "Run verification playbook",
          input: {
            action: "verify_playbook",
            playbook: context.providerConfig.verifyPlaybookPath || "verify.yml",
          },
          estimatedDurationSeconds: 60,
        },
      ],
      rollbackSteps: [
        {
          position: 0,
          kind: "rollback",
          name: "Run rollback playbook",
          description: "Execute rollback playbook to revert changes",
          input: {
            action: "run_rollback_playbook",
            playbook: context.providerConfig.rollbackPlaybookPath || "rollback.yml",
          },
          referencesStepPosition: 1,
        },
      ],
      metadata: { host: context.providerConfig.host },
    };

    const validationErrors = validateExecutionPlan(plan);
    if (validationErrors.length > 0) {
      return this.failure("Invalid plan generated", { errors: validationErrors });
    }

    return this.success(plan);
  }

  async executeStep(
    context: ProviderContext,
    step: { kind: DeploymentStepKind; name: string; input: Record<string, unknown> },
  ): Promise<ProviderResult> {
    this.log(context, "info", `Executing mock step: ${step.name}`, { kind: step.kind });

    await new Promise((resolve) => setTimeout(resolve, 100));

    switch (step.kind) {
      case "validation":
        return this.success({ ssh: "ok", sudo: true, host: context.providerConfig.host });
      case "provisioning":
        return this.success({
          playbook: step.input.playbook,
          result: "ok",
          changed: 5,
          failed: 0,
          unreachable: 0,
        });
      case "verification":
        return this.success({ verified: true, checks: ["service_running", "port_open", "config_valid"] });
      default:
        return this.success({ completed: true });
    }
  }

  async executeRollback(
    context: ProviderContext,
    step: { kind: DeploymentStepKind; name: string; input: Record<string, unknown> },
    forwardStepOutput: Record<string, unknown>,
  ): Promise<ProviderResult> {
    this.log(context, "warn", `Executing mock rollback: ${step.name}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    return this.success({ rolledBack: true, playbook: step.input.playbook });
  }

  async verify(context: ProviderContext, plan: ExecutionPlan): Promise<ProviderResult> {
    this.log(context, "info", "Verifying mock SSH/Ansible deployment");
    return this.success({ verified: true });
  }
}

/**
 * Mock Docker Engine Provider - simulates Docker API operations.
 * Replace with real implementation in Stage 13.
 */
export class MockDockerEngineProvider extends BaseProvider {
  readonly type = "docker_engine" as const;
  readonly name = "Docker Engine (Mock)";

  async plan(context: ProviderContext): Promise<ProviderResult<ExecutionPlan>> {
    this.log(context, "info", "Generating mock Docker Engine execution plan");

    const plan: ExecutionPlan = {
      version: 1,
      providerType: this.type,
      steps: [
        {
          position: 0,
          kind: "validation",
          name: "Test Docker daemon connectivity",
          description: "Verify Docker API access",
          input: { action: "ping", host: context.providerConfig.host },
          estimatedDurationSeconds: 5,
        },
        {
          position: 1,
          kind: "provisioning",
          name: "Deploy Docker stack",
          description: "Deploy services via Docker Swarm",
          input: {
            action: "deploy_stack",
            stackName: context.providerConfig.stackName,
            composeFile: context.jobParams.composeFile,
            registryAuth: context.credentials.registryAuth,
          },
          estimatedDurationSeconds: 120,
        },
        {
          position: 2,
          kind: "verification",
          name: "Verify stack services",
          description: "Check all services are running and healthy",
          input: { action: "verify_stack", stackName: context.providerConfig.stackName },
          estimatedDurationSeconds: 30,
        },
      ],
      rollbackSteps: [
        {
          position: 0,
          kind: "rollback",
          name: "Remove Docker stack",
          description: "Remove the deployed stack on failure",
          input: { action: "remove_stack", stackName: context.providerConfig.stackName },
          referencesStepPosition: 1,
        },
      ],
      metadata: { host: context.providerConfig.host },
    };

    const validationErrors = validateExecutionPlan(plan);
    if (validationErrors.length > 0) {
      return this.failure("Invalid plan generated", { errors: validationErrors });
    }

    return this.success(plan);
  }

  async executeStep(
    context: ProviderContext,
    step: { kind: DeploymentStepKind; name: string; input: Record<string, unknown> },
  ): Promise<ProviderResult> {
    this.log(context, "info", `Executing mock step: ${step.name}`, { kind: step.kind });

    await new Promise((resolve) => setTimeout(resolve, 100));

    switch (step.kind) {
      case "validation":
        return this.success({ docker: "ok", version: "27.1.0", swarm: true });
      case "provisioning":
        return this.success({ stack: step.input.stackName, services: 3, status: "deployed" });
      case "verification":
        return this.success({ healthy: true, services: { web: "healthy", db: "healthy", cache: "healthy" } });
      default:
        return this.success({ completed: true });
    }
  }

  async executeRollback(
    context: ProviderContext,
    step: { kind: DeploymentStepKind; name: string; input: Record<string, unknown> },
    forwardStepOutput: Record<string, unknown>,
  ): Promise<ProviderResult> {
    this.log(context, "warn", `Executing mock rollback: ${step.name}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    return this.success({ rolledBack: true, stackRemoved: step.input.stackName });
  }

  async verify(context: ProviderContext, plan: ExecutionPlan): Promise<ProviderResult> {
    this.log(context, "info", "Verifying mock Docker deployment");
    return this.success({ verified: true, stackStatus: "healthy" });
  }
}

/**
 * Mock Docker Compose Provider - simulates Docker Compose operations.
 * Replace with real implementation in Stage 13.
 */
export class MockDockerComposeProvider extends BaseProvider {
  readonly type = "docker_compose" as const;
  readonly name = "Docker Compose (Mock)";

  async plan(context: ProviderContext): Promise<ProviderResult<ExecutionPlan>> {
    this.log(context, "info", "Generating mock Docker Compose execution plan");

    const plan: ExecutionPlan = {
      version: 1,
      providerType: this.type,
      steps: [
        {
          position: 0,
          kind: "validation",
          name: "Validate compose file",
          description: "Check docker-compose.yml syntax and requirements",
          input: { action: "config", projectPath: context.providerConfig.projectPath },
          estimatedDurationSeconds: 10,
        },
        {
          position: 1,
          kind: "provisioning",
          name: "Deploy with docker compose",
          description: "Start services defined in compose file",
          input: {
            action: "up",
            projectPath: context.providerConfig.projectPath,
            projectName: context.providerConfig.stackName,
            detach: true,
            build: context.jobParams.build || false,
          },
          estimatedDurationSeconds: 120,
        },
        {
          position: 2,
          kind: "verification",
          name: "Verify containers",
          description: "Check all containers are running and healthy",
          input: { action: "ps", projectName: context.providerConfig.stackName },
          estimatedDurationSeconds: 15,
        },
      ],
      rollbackSteps: [
        {
          position: 0,
          kind: "rollback",
          name: "Stop and remove containers",
          description: "Stop and remove compose project on failure",
          input: { action: "down", projectName: context.providerConfig.stackName, volumes: true },
          referencesStepPosition: 1,
        },
      ],
      metadata: { projectPath: context.providerConfig.projectPath },
    };

    const validationErrors = validateExecutionPlan(plan);
    if (validationErrors.length > 0) {
      return this.failure("Invalid plan generated", { errors: validationErrors });
    }

    return this.success(plan);
  }

  async executeStep(
    context: ProviderContext,
    step: { kind: DeploymentStepKind; name: string; input: Record<string, unknown> },
  ): Promise<ProviderResult> {
    this.log(context, "info", `Executing mock step: ${step.name}`, { kind: step.kind });

    await new Promise((resolve) => setTimeout(resolve, 100));

    switch (step.kind) {
      case "validation":
        return this.success({ config: "valid", services: ["web", "db", "cache"] });
      case "provisioning":
        return this.success({ project: step.input.projectName, status: "started", containers: 3 });
      case "verification":
        return this.success({ running: 3, healthy: 3, containers: ["web", "db", "cache"] });
      default:
        return this.success({ completed: true });
    }
  }

  async executeRollback(
    context: ProviderContext,
    step: { kind: DeploymentStepKind; name: string; input: Record<string, unknown> },
    forwardStepOutput: Record<string, unknown>,
  ): Promise<ProviderResult> {
    this.log(context, "warn", `Executing mock rollback: ${step.name}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    return this.success({ rolledBack: true, projectDown: step.input.projectName });
  }

  async verify(context: ProviderContext, plan: ExecutionPlan): Promise<ProviderResult> {
    this.log(context, "info", "Verifying mock Docker Compose deployment");
    return this.success({ verified: true });
  }
}

/**
 * Mock NAS Generic Provider - simulates generic NAS API operations.
 * Replace with real implementation in Stage 13.
 */
export class MockNasGenericProvider extends BaseProvider {
  readonly type = "nas_generic" as const;
  readonly name = "Generic NAS (Mock)";

  async plan(context: ProviderContext): Promise<ProviderResult<ExecutionPlan>> {
    this.log(context, "info", "Generating mock NAS execution plan");

    const plan: ExecutionPlan = {
      version: 1,
      providerType: this.type,
      steps: [
        {
          position: 0,
          kind: "validation",
          name: "Test NAS API connectivity",
          description: "Verify API access and permissions",
          input: { action: "test_api", url: context.providerConfig.apiUrl },
          estimatedDurationSeconds: 10,
        },
        {
          position: 1,
          kind: "provisioning",
          name: "Create volume/share",
          description: "Provision storage volume or share",
          input: {
            action: "create_volume",
            path: context.providerConfig.volumePath,
            size: context.jobParams.size || "100G",
            protocol: context.jobParams.protocol || "nfs",
          },
          estimatedDurationSeconds: 30,
        },
        {
          position: 2,
          kind: "configuration",
          name: "Configure access permissions",
          description: "Set up user/group access and quotas",
          input: {
            action: "configure_access",
            path: context.providerConfig.volumePath,
            users: context.jobParams.users || [],
            readonly: context.jobParams.readonly || false,
          },
          estimatedDurationSeconds: 15,
        },
        {
          position: 3,
          kind: "verification",
          name: "Verify volume accessibility",
          description: "Test mount and read/write access",
          input: { action: "verify_access", path: context.providerConfig.volumePath },
          estimatedDurationSeconds: 15,
        },
      ],
      rollbackSteps: [
        {
          position: 0,
          kind: "rollback",
          name: "Delete volume on failure",
          description: "Remove created volume if deployment fails",
          input: { action: "delete_volume", path: context.providerConfig.volumePath },
          referencesStepPosition: 1,
        },
      ],
      metadata: { apiUrl: context.providerConfig.apiUrl },
    };

    const validationErrors = validateExecutionPlan(plan);
    if (validationErrors.length > 0) {
      return this.failure("Invalid plan generated", { errors: validationErrors });
    }

    return this.success(plan);
  }

  async executeStep(
    context: ProviderContext,
    step: { kind: DeploymentStepKind; name: string; input: Record<string, unknown> },
  ): Promise<ProviderResult> {
    this.log(context, "info", `Executing mock step: ${step.name}`, { kind: step.kind });

    await new Promise((resolve) => setTimeout(resolve, 100));

    switch (step.kind) {
      case "validation":
        return this.success({ api: "ok", version: "1.0", features: ["nfs", "smb", "iscsi"] });
      case "provisioning":
        return this.success({ volume: step.input.path, size: step.input.size, created: true });
      case "configuration":
        return this.success({ permissions: "configured", users: step.input.users });
      case "verification":
        return this.success({ accessible: true, read: "ok", write: "ok" });
      default:
        return this.success({ completed: true });
    }
  }

  async executeRollback(
    context: ProviderContext,
    step: { kind: DeploymentStepKind; name: string; input: Record<string, unknown> },
    forwardStepOutput: Record<string, unknown>,
  ): Promise<ProviderResult> {
    this.log(context, "warn", `Executing mock rollback: ${step.name}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    return this.success({ rolledBack: true, volumeDeleted: step.input.path });
  }

  async verify(context: ProviderContext, plan: ExecutionPlan): Promise<ProviderResult> {
    this.log(context, "info", "Verifying mock NAS deployment");
    return this.success({ verified: true, volumeStatus: "online" });
  }
}

/**
 * Provider registry - maps provider types to implementations.
 * In Stage 13, real implementations will be registered here.
 */
export const providerRegistry = new Map<DeploymentProviderType, DeploymentProvider>([
  ["proxmox", new RealProxmoxProvider()],
  ["ssh_ansible", new RealSshAnsibleProvider()],
  ["docker_engine", new RealDockerEngineProvider()],
  ["docker_compose", new RealDockerComposeProvider()],
  ["nas_generic", new RealNasGenericProvider()],
]);

/**
 * Get a provider instance by type.
 */
export function getProvider(type: DeploymentProviderType): DeploymentProvider | undefined {
  return providerRegistry.get(type);
}

/**
 * Register a provider (for real implementations in Stage 13).
 */
export function registerProvider(provider: DeploymentProvider): void {
  providerRegistry.set(provider.type, provider);
}

/**
 * List all available provider types.
 */
export function listProviderTypes(): DeploymentProviderType[] {
  return Array.from(providerRegistry.keys());
}