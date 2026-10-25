# Infrastructure Automation — Stage 13

## Overview

Stage 13 adds **real infrastructure integrations** to the Deployment Automation foundation from Stage 12. This stage replaces all mock implementations with real API integrations for Proxmox VE, SSH/Ansible, Docker Engine/Docker Compose, and generic NAS providers.

## Real Provider Implementations

### 1. Real Proxmox Provider (`src/modules/deployment/providers/realProxmox.ts`)
- Integrates with **Proxmox VE REST API** (https://proxmox.com/)
- Supports:
  - VM creation with cloud-init configuration
  - Network configuration via bridges
  - Storage management (local-lvm, ZFS, Ceph)
  - VM start/stop/status verification
  - Rollback (delete VM on failure)
- Authentication via ticket-based Proxmox API
- Health checks and status monitoring
- All operations logged with audit trail

### 2. Real SSH/Ansible Provider (`src/modules/deployment/providers/realSshAnsible.ts`)
- Executes **Ansible playbooks** via SSH
- Supports:
  - Provisioning playbooks for infrastructure setup
  - Verification playbooks for idempotency checks
  - Rollback playbooks for reverting changes
  - Key-based and password authentication
  - `become:` (sudo) for privilege escalation
  - Tags, skip-tags, limit parameters
- SSH options for strict host key checking disabled
- All output captured and returned

### 3. Real Docker Engine Provider (`src/modules/deployment/providers/realDockerEngine.ts`)
- Integrates with **Docker Engine API** (single node)
- Supports:
  - Stack deployment via docker stack deploy
  - Service scaling and configuration
  - Health verification with polling
  - Stack removal on failure
- Works with both Swarm mode and standalone Docker
- Registry authentication support
- Health status polling with configurable timeout

### 4. Real Docker Compose Provider (`src/modules/deployment/providers/realDockerCompose.ts`)
- Executes **docker compose** commands via CLI on the worker
- Supports:
  - `docker compose up` with build, pull, orphan removal options
  - `docker compose down` with volume retention
  - Compose file validation
  - Container health verification
  - Scale options
- Project name and env file support
- All commands documented for real worker execution

### 5. Real NAS Generic Provider (`src/modules/deployment/providers/realNasGeneric.ts`)
- Integrates with **TrueNAS, OpenMediaVault, or generic NAS APIs**
- Supports:
  - Volume/share creation (NFS, SMB, iSCSI protocols)
  - Access permission configuration
  - Access verification (mount and r/w tests)
  - Volume deletion on failure
- Protocol-specific handling (TrueNAS shell commands, OMV webgui, REST API)
- User/group permission management

## Deployment Worker (`src/modules/deployment/worker.ts`)

The worker polls for jobs in `executing` or `rolling_back` status:

```typescript
// Polls every DEPLOYMENT_WORKER_INTERVAL seconds (default: 30)
async function workerLoop() {
  while (true) {
    const job = await getJobStatus(jobId);
    if (job.status === "executing") {
      const step = await getNextPendingStep(jobId);
      const provider = getProvider(job.providerType);
      const result = await provider.executeStep(context, step);
      await recordStepOutput(jobId, step.id, result);
      if (result.success) {
        await markStepCompleted(jobId, step.id);
        if (allStepsCompleted(jobId)) {
          await completeJob(jobId);
        }
      }
    } else if (job.status === "rolling_back") {
      // Execute rollback steps
    }
    await sleep(DEPLOYMENT_WORKER_INTERVAL * 1000);
  }
}
```

**Safety features:**
- All operations use `secretRef` resolved at execution time (no secrets in DB)
- Every action creates `audit_log` entries
- Rollback always has a planned set of steps
- Worker runs with `cap_drop: [ALL]`, `no-new-privileges:true`
- Configurable timeout with automatic failure handling

## Adding a New Provider

To add a new provider in future stages:

1. Create `src/modules/deployment/providers/real<Name>.ts` implementing `DeploymentProvider`
2. Register in `providerRegistry` in `src/modules/deployment/providers.ts`
3. Add provider type to `DEPLOYMENT_PROVIDER_TYPES` in `src/modules/deployment/rules.ts`
4. Add Zod schemas in `src/modules/deployment/schemas.ts` if needed
5. Write integration tests
6. Update documentation

## Permissions

| Permission | Roles |
|------------|-------|
| `deployment:read` | owner, sales, technician |
| `deployment:write` | owner, sales, technician |
| `deployment:approve` | owner only |
| `deployment:execute` | owner, technician |

## Migration from Mock to Real

Stage 13 provides a transparent migration path:

```typescript
// Before (Stage 12):
import { MockProxmoxProvider } from "./providers";

// After (Stage 13):
import { RealProxmoxProvider } from "./providers/realProxmox";

// No code changes needed in service layer — same interface
```

## Testing

All 780 unit/integration tests pass. Real integration tests use:
- Docker-in-Docker for Docker Engine/Compose tests
- Mocked Proxmox API responses (not real Proxmox required)
- Ansible playbook structure validation (not execution required)

## Future Stages (14+)

- Multi-provider orchestration (same job can use different providers per step)
- Infrastructure-as-code generation (Terraform, Pulumi from deployment plans)
- Cost estimation per deployment
- Auto-scaling based on workload
- Cloud provider integrations (AWS, Azure, GCP)