# Deployment Automation (Stage 12)

This document describes the deployment automation foundation implemented in Stage 12 of ServerWise.

## Overview

Stage 12 provides the **infrastructure automation foundations** — interfaces, data models, approval workflows, and mock provider implementations — that enable safe, auditable deployment of infrastructure configurations. Real provider integrations (Proxmox, Ansible, Docker, NAS) will be implemented in Stage 13.

## Architecture

### Safety Model (Mandatory)

- **Opt-in only**: Automation is disabled by default (`DEPLOYMENT_AUTOMATION_ENABLED=false`)
- **No arbitrary shell execution**: No `exec()`, no direct SSH from the web application
- **Isolated worker**: Background worker runs with `cap_drop: [ALL]`, `no-new-privileges:true`
- **Short-lived credentials**: Secrets resolved at execution time via `secretRef` (Vault, env vars, files)
- **Explicit approval**: Every sensitive job requires recorded approvals
- **Full audit trail**: Every step logged to `deployment_log`, every state change to `audit_log`

### Layered Architecture

```
UI (server actions)
  ↓
Service Layer (authorization first, then business logic)
  ↓
Repository Layer (Prisma only)
  ↓
PostgreSQL
```

Providers implement the `DeploymentProvider` interface:
- `plan()` — generates an execution plan for human review
- `executeStep()` — runs a single step
- `executeRollback()` — rolls back a specific forward step
- `verify()` — confirms desired state after completion
- `healthCheck()` — monitoring endpoint

## Data Model

### Core Entities

| Entity | Purpose |
|--------|---------|
| `DeploymentProvider` | Configured provider (Proxmox cluster, SSH host, Docker daemon) |
| `DeploymentCredential` | Credential reference (NOT the secret itself — points to Vault/env/file) |
| `DeploymentJob` | Execution of a plan against a provider |
| `DeploymentStep` | Single step in a job (validation, provisioning, configuration, verification, rollback) |
| `DeploymentApproval` | Approval record (multiple can be required per job) |
| `DeploymentLog` | Structured log entries for steps (append-only) |

### State Machines

**DeploymentJob**
```
pending_approval → approved → planned → executing → completed
                    ↘ rejected
                    ↘ cancelled
executing → failed → rolling_back → rolled_back
executing → cancelled
```

**DeploymentStep**
```
pending → running → completed
           ↘ failed → (retry) → running
           ↘ skipped
completed → rolled_back (during rollback)
```

## Provider Types (Mock Implementations)

| Type | Description | Mock Implementation |
|------|-------------|---------------------|
| `proxmox` | Proxmox VE API | Creates VMs, configures network, verifies |
| `ssh_ansible` | SSH + Ansible playbooks | Runs playbooks, verifies |
| `docker_engine` | Docker Swarm API | Deploys stacks, verifies services |
| `docker_compose` | Docker Compose CLI | Runs compose up/down, verifies containers |
| `nas_generic` | Generic NAS API | Creates volumes, configures access |
| `custom` | Extensible | For future real implementations |

## Credential Management

**Never stores raw secrets**. Each `DeploymentCredential` has:
- `secretRef`: Reference to where the secret lives
  - `vault:secret/data/path/to/secret`
  - `env:ENV_VAR_NAME`
  - `file:/run/secrets/secret_name`
- `metadata`: Additional info (SSH fingerprint, token expiry, etc.)

The worker resolves secrets at execution time only.

## Approval Workflow

1. Job created in `pending_approval` status
2. Required approvals defined (by role or specific user)
3. Approvers review the generated execution plan
4. All approvals must be granted before job moves to `planned`
5. Job can then be executed (manually or via worker)
6. Any rejection moves job to `rejected` with reason recorded

## Server Actions

Located in `src/modules/deployment/service.ts`:

| Action | Permission | Description |
|--------|------------|-------------|
| `listProviders` | `deployment:read` | List configured providers |
| `getProviderById` | `deployment:read` | Get provider details |
| `createProvider` | `deployment:write` | Create new provider |
| `updateProvider` | `deployment:write` | Update provider |
| `listCredentials` | `deployment:read` | List credentials |
| `listDeploymentJobs` | `deployment:read` | List jobs with filters |
| `getDeploymentJob` | `deployment:read` | Get job with steps/logs/approvals |
| `approveJob` | `deployment:approve` | Approve a pending job |
| `rejectJob` | `deployment:approve` | Reject a pending job |
| `executeJob` | `deployment:execute` | Trigger job execution |
| `rollbackJob` | `deployment:execute` | Initiate rollback |
| `createStep` | `deployment:write` | Add step to job |
| `updateStep` | `deployment:write` | Update step |
| `listStepLogs` | `deployment:read` | Get step logs |

## Permissions

| Permission | Roles | Description |
|------------|-------|-------------|
| `deployment:read` | owner, sales, technician | View providers, credentials, jobs, logs |
| `deployment:write` | owner, sales, technician | Create/update providers, credentials, jobs, steps |
| `deployment:approve` | owner | Approve/reject jobs for execution |
| `deployment:execute` | owner, technician | Execute jobs, trigger rollbacks (worker) |

## Background Worker

Run with: `pnpm worker:deployments` (to be implemented in Stage 13)

The worker:
1. Polls for jobs in `executing` or `rolling_back` status
2. Fetches next pending step
3. Resolves credentials via `secretRef`
4. Calls provider's `executeStep()` or `executeRollback()`
5. Records output, updates step status
6. On job completion, calls provider's `verify()`
7. All operations logged to `deployment_log` and `audit_log`

## Configuration

Environment variables:
```env
# Enable deployment automation (default: false)
DEPLOYMENT_AUTOMATION_ENABLED=false

# Worker polling interval (seconds, default: 30)
DEPLOYMENT_WORKER_INTERVAL=30
```

## Adding a Real Provider (Stage 13)

1. Create a class implementing `DeploymentProvider` interface
2. Implement all abstract methods: `plan()`, `executeStep()`, `executeRollback()`, `verify()`, `healthCheck()`
3. Register in `providerRegistry` in `src/modules/deployment/providers.ts`
4. Add provider-specific config validation in `validateProviderConfig()`
5. Write integration tests

Example:
```typescript
// src/modules/deployment/providers/realProxmox.ts
export class RealProxmoxProvider extends BaseProvider {
  readonly type = "proxmox" as const;
  readonly name = "Proxmox VE";

  async plan(context) { ... }
  async executeStep(context, step) { ... }
  async executeRollback(context, step, forwardOutput) { ... }
  async verify(context, plan) { ... }
}

// In providers.ts:
import { RealProxmoxProvider } from "./providers/realProxmox";
providerRegistry.set("proxmox", new RealProxmoxProvider());
```

## Security Considerations

- **No secrets in database**: Only references (`secretRef`)
- **Audit every action**: All mutations create `audit_log` entries
- **Least privilege**: Worker runs with minimal capabilities
- **Idempotency**: Jobs use `idempotencyKey` for safe retries
- **Rollback always planned**: Every plan includes rollback steps
- **Approval gate**: No execution without explicit approval

## Testing

```bash
# Unit tests (rules, schemas)
pnpm test -- tests/unit/deployment-*.test.ts

# Integration tests (require database)
pnpm test -- tests/integration/deployment-*.test.ts

# Lint + typecheck + build
pnpm lint && pnpm typecheck && pnpm build
```

## Future Work (Stage 13+)

- Real provider implementations
- Job scheduling and cron triggers
- Multi-step rollback orchestration
- Webhook notifications for job status changes
- Deployment templates and reuse
- Cost tracking per job
- Integration with project workflows (auto-create jobs from accepted quotes)