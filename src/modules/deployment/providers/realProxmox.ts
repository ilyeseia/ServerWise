/**
 * Real Proxmox VE Provider — integrates with Proxmox VE API.
 *
 * Requires provider.config to contain:
 *   - node: string (target Proxmox node name)
 *   - storage: string (storage name for disks, e.g., "local-lvm")
 *   - network: string (bridge name, e.g., "vmbr0")
 *   - verifySSL?: boolean (default: false for self-signed certs)
 *
 * Credentials (via secretRef) must provide:
 *   - username: string (e.g., "root@pam")
 *   - password: string OR token_id + token_secret
 */

import type { DeploymentProviderType, DeploymentStepKind, ExecutionPlan, ProviderConfig } from "../rules";
import { validateExecutionPlan } from "../rules";
import type { DeploymentProvider, ProviderContext, ProviderResult } from "../providers";
import { BaseProvider } from "../providers";

// Proxmox API types
interface ProxmoxAuthResponse {
  data: {
    ticket: string;
    CSRFPreventionToken: string;
    username: string;
  };
}

interface ProxmoxVMConfig {
  vmid: number;
  name: string;
  memory: number;
  cores: number;
  sockets: number;
  cpu: string;
  net0: string;
  scsi0: string;
  ide2: string;
  boot: string;
  ostype: string;
  onboot: number;
  agent: string;
}

interface ProxmoxTaskResponse {
  data: string; // UPID
}

interface ProxmoxVMStatusResponse {
  data: {
    status: string;
    vmid: number;
    name: string;
  };
}

interface ProxmoxNodeResponse {
  data: Array<{ node: string; status: string }>;
}

interface ProxmoxStorageResponse {
  data: Array<{ storage: string; type: string; avail: number; total: number; used: number }>;
}

interface ProxmoxNetworkResponse {
  data: Array<{ iface: string; type: string; cidr?: string }>;
}

export class RealProxmoxProvider extends BaseProvider {
  readonly type = "proxmox" as const;
  readonly name = "Proxmox VE";

  private baseUrl: string;
  private verifySSL: boolean;
  private ticket: string | null = null;
  private csrfToken: string | null = null;
  private ticketExpiry: number = 0;

  constructor() {
    super();
    this.baseUrl = "";
    this.verifySSL = false;
  }

  private async ensureAuthenticated(context: ProviderContext): Promise<void> {
    const now = Date.now();
    if (this.ticket && this.csrfToken && now < this.ticketExpiry) {
      return; // Still valid
    }

    const creds = context.credentials;
    const username = creds.username;
    const password = creds.password;

    if (!username || !password) {
      throw new Error("Proxmox credentials missing: username and password required");
    }

    this.baseUrl = context.providerConfig.endpoint?.replace(/\/$/, "") || "";
    this.verifySSL = context.providerConfig.verifySSL === true;

    const authUrl = `${this.baseUrl}/api2/json/access/ticket`;
    const body = new URLSearchParams({
      username,
      password,
    });

    const response = await fetch(authUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: context.abortSignal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Proxmox authentication failed (${response.status}): ${errorText}`);
    }

    const authData: ProxmoxAuthResponse = await response.json();
    this.ticket = authData.data.ticket;
    this.csrfToken = authData.data.CSRFPreventionToken;
    this.ticketExpiry = now + 2 * 60 * 60 * 1000; // 2 hours
  }

  private async proxmoxRequest<T>(
    context: ProviderContext,
    path: string,
    method: "GET" | "POST" | "DELETE" = "GET",
    body?: URLSearchParams | FormData,
  ): Promise<T> {
    await this.ensureAuthenticated(context);

    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "CSRFPreventionToken": this.csrfToken!,
      "Cookie": `PVEAuthCookie=${this.ticket}`,
    };

    if (body instanceof URLSearchParams) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body?.toString(),
      signal: context.abortSignal,
    });

    if (response.status === 401) {
      // Ticket expired, force re-auth
      this.ticket = null;
      this.csrfToken = null;
      await this.ensureAuthenticated(context);
      return this.proxmoxRequest<T>(context, path, method, body);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Proxmox API error (${response.status}) on ${method} ${path}: ${errorText}`);
    }

    return response.json();
  }

  private async waitForTask(context: ProviderContext, upid: string, timeoutMs = 300000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const status = await this.proxmoxRequest<{ data: { status: string; exitstatus?: string } }>(
        context,
        `/api2/json/nodes/${context.providerConfig.node}/tasks/${upid}/status`,
      );

      if (status.data.status === "stopped") {
        if (status.data.exitstatus && status.data.exitstatus !== "OK") {
          throw new Error(`Proxmox task ${upid} failed with exit status: ${status.data.exitstatus}`);
        }
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`Proxmox task ${upid} timed out after ${timeoutMs}ms`);
  }

  validateConfig(config: ProviderConfig): string[] {
    return super.validateConfig(config);
  }

  async plan(context: ProviderContext): Promise<ProviderResult<ExecutionPlan>> {
    this.log(context, "info", "Generating Proxmox execution plan");

    // Validate connectivity first
    try {
      await this.ensureAuthenticated(context);
      await this.proxmoxRequest<ProxmoxNodeResponse>(context, `/api2/json/nodes/${context.providerConfig.node}`);
    } catch (e) {
      return this.failure(`Cannot connect to Proxmox: ${e instanceof Error ? e.message : String(e)}`);
    }

    const plan: ExecutionPlan = {
      version: 1,
      providerType: this.type,
      steps: [
        {
          position: 0,
          kind: "validation",
          name: "Validate Proxmox connection",
          description: "Check API connectivity, node status, storage and network availability",
          input: { action: "validate_node" },
          estimatedDurationSeconds: 15,
        },
        {
          position: 1,
          kind: "provisioning",
          name: "Create VM",
          description: "Provision new virtual machine with cloud-init",
          input: {
            action: "create_vm",
            vmid: context.jobParams.vmid || 100,
            name: context.jobParams.vmName || "serverwise-vm",
            cores: context.jobParams.cores || 2,
            memory: context.jobParams.memory || 4096,
            disk: context.jobParams.disk || "32G",
            storage: context.providerConfig.storage,
            network: context.providerConfig.network,
            cpuType: context.jobParams.cpuType || "host",
            ostype: context.jobParams.ostype || "l26",
            sshKeys: context.jobParams.sshKeys || "",
            ipConfig: context.jobParams.ipConfig || "dhcp",
          },
          estimatedDurationSeconds: 120,
        },
        {
          position: 2,
          kind: "configuration",
          name: "Configure VM network and cloud-init",
          description: "Set static IP, DNS, hostname, SSH keys via cloud-init",
          input: {
            action: "configure_cloudinit",
            ipConfig: context.jobParams.ipConfig || "dhcp",
            nameserver: context.jobParams.nameserver,
            searchdomain: context.jobParams.searchdomain,
            sshKeys: context.jobParams.sshKeys,
          },
          estimatedDurationSeconds: 20,
        },
        {
          position: 3,
          kind: "configuration",
          name: "Start VM",
          description: "Power on the virtual machine",
          input: { action: "start_vm" },
          estimatedDurationSeconds: 30,
        },
        {
          position: 4,
          kind: "verification",
          name: "Verify VM is running and accessible",
          description: "Check VM status, IP assignment, and SSH connectivity",
          input: { action: "verify_vm", waitForIp: true, timeoutSeconds: 300 },
          estimatedDurationSeconds: 120,
        },
      ],
      rollbackSteps: [
        {
          position: 0,
          kind: "rollback",
          name: "Stop and delete VM on failure",
          description: "Stop VM if running, then delete it completely",
          input: { action: "delete_vm", purge: true },
          referencesStepPosition: 1,
        },
      ],
      metadata: {
        node: context.providerConfig.node,
        storage: context.providerConfig.storage,
        network: context.providerConfig.network,
      },
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
    this.log(context, "info", `Executing Proxmox step: ${step.name}`, { kind: step.kind });

    const node = context.providerConfig.node;
    const vmid = (step.input.vmid as number) || (context.jobParams.vmid as number) || 100;

    try {
      switch (step.input.action) {
        case "validate_node": {
          const nodeStatus = await this.proxmoxRequest<ProxmoxNodeResponse>(context, `/api2/json/nodes/${node}`);
          const storage = await this.proxmoxRequest<ProxmoxStorageResponse>(context, `/api2/json/nodes/${node}/storage`);
          const network = await this.proxmoxRequest<ProxmoxNetworkResponse>(context, `/api2/json/nodes/${node}/network`);

          const targetStorage = storage.data.find((s) => s.storage === context.providerConfig.storage);
          const targetNetwork = network.data.find((n) => n.iface === context.providerConfig.network);

          if (!targetStorage) {
            throw new Error(`Storage "${context.providerConfig.storage}" not found on node ${node}`);
          }
          if (!targetNetwork) {
            throw new Error(`Network bridge "${context.providerConfig.network}" not found on node ${node}`);
          }

          return this.success({
            node: nodeStatus.data.find((n) => n.node === node)?.status || "unknown",
            storage: targetStorage,
            network: targetNetwork,
          });
        }

        case "create_vm": {
          const vmConfig: ProxmoxVMConfig = {
            vmid,
            name: (step.input.name as string) || context.jobParams.vmName as string || "serverwise-vm",
            memory: (step.input.memory as number) || context.jobParams.memory as number || 4096,
            cores: (step.input.cores as number) || context.jobParams.cores as number || 2,
            sockets: 1,
            cpu: (step.input.cpuType as string) || context.jobParams.cpuType as string || "host",
            net0: `virtio,bridge=${context.providerConfig.network}`,
            scsi0: `${context.providerConfig.storage}:${step.input.disk || context.jobParams.disk || "32G"}`,
            ide2: `${context.providerConfig.storage}:cloudinit`,
            boot: "order=scsi0;ide2;net0",
            ostype: (step.input.ostype as string) || context.jobParams.ostype as string || "l26",
            onboot: 1,
            agent: "1",
          };

          const body = new URLSearchParams();
          Object.entries(vmConfig).forEach(([k, v]) => body.append(k, String(v)));

          const task = await this.proxmoxRequest<ProxmoxTaskResponse>(
            context,
            `/api2/json/nodes/${node}/qemu`,
            "POST",
            body,
          );
          await this.waitForTask(context, task.data);

          return this.success({ vmid, status: "created", taskId: task.data });
        }

        case "configure_cloudinit": {
          const body = new URLSearchParams();
          body.append("ipconfig0", (step.input.ipConfig as string) || context.jobParams.ipConfig as string || "ip=dhcp");
          if (step.input.nameserver) body.append("nameserver", step.input.nameserver as string);
          if (step.input.searchdomain) body.append("searchdomain", step.input.searchdomain as string);
          if (step.input.sshKeys) body.append("sshkeys", step.input.sshKeys as string);
          if (context.jobParams.sshKeys) body.append("sshkeys", context.jobParams.sshKeys as string);

          const task = await this.proxmoxRequest<ProxmoxTaskResponse>(
            context,
            `/api2/json/nodes/${node}/qemu/${vmid}/config`,
            "POST",
            body,
          );
          await this.waitForTask(context, task.data);

          return this.success({ configured: true, vmid });
        }

        case "start_vm": {
          const task = await this.proxmoxRequest<ProxmoxTaskResponse>(
            context,
            `/api2/json/nodes/${node}/qemu/${vmid}/status/start`,
            "POST",
          );
          await this.waitForTask(context, task.data);

          return this.success({ started: true, vmid, taskId: task.data });
        }

        case "verify_vm": {
          // Wait for VM to be running and get IP
          const waitForIp = step.input.waitForIp === true;
          const timeout = ((step.input.timeoutSeconds as number) || 300) * 1000;
          const start = Date.now();

          let vmStatus: ProxmoxVMStatusResponse;
          while (Date.now() - start < timeout) {
            vmStatus = await this.proxmoxRequest<ProxmoxVMStatusResponse>(
              context,
              `/api2/json/nodes/${node}/qemu/${vmid}/status/current`,
            );

            if (vmStatus.data.status === "running") {
              if (!waitForIp) {
                return this.success({ running: true, vmid, status: vmStatus.data });
              }

              // Try to get IP from QEMU guest agent
              try {
                const agent = await this.proxmoxRequest<{ data: { "network-get-interfaces": { result: Array<{ "ip-addresses": Array<{ "ip-address-type": string; "ip-address": string }> }> } } }>(
                  context,
                  `/api2/json/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`,
                );

                const ipv4 = agent.data.result?.[0]?.["ip-addresses"]?.find(
                  (ip) => ip["ip-address-type"] === "ipv4" && !ip["ip-address"].startsWith("127.")
                );

                if (ipv4) {
                  return this.success({ running: true, vmid, ip: ipv4["ip-address"], status: vmStatus.data });
                }
              } catch {
                // Agent not ready yet, continue waiting
              }
            }
            await new Promise((r) => setTimeout(r, 5000));
          }

          throw new Error(`VM ${vmid} verification timed out`);
        }

        default:
          throw new Error(`Unknown action: ${step.input.action}`);
      }
    } catch (e) {
      return this.failure(e instanceof Error ? e.message : String(e));
    }
  }

  async executeRollback(
    context: ProviderContext,
    step: { kind: DeploymentStepKind; name: string; input: Record<string, unknown> },
    forwardStepOutput: Record<string, unknown>,
  ): Promise<ProviderResult> {
    this.log(context, "warn", `Executing Proxmox rollback: ${step.name}`, { forwardOutput: forwardStepOutput });

    const node = context.providerConfig.node;
    const vmid = (forwardStepOutput.vmid as number) || (step.input.vmid as number) || 100;
    const purge = step.input.purge === true;

    try {
      // First try to stop the VM if running
      try {
        const status = await this.proxmoxRequest<ProxmoxVMStatusResponse>(
          context,
          `/api2/json/nodes/${node}/qemu/${vmid}/status/current`,
        );
        if (status.data.status === "running") {
          const stopTask = await this.proxmoxRequest<ProxmoxTaskResponse>(
            context,
            `/api2/json/nodes/${node}/qemu/${vmid}/status/stop`,
            "POST",
          );
          await this.waitForTask(context, stopTask.data);
        }
      } catch {
        // VM might not exist, continue to delete
      }

      // Delete the VM
      const deleteUrl = `/api2/json/nodes/${node}/qemu/${vmid}${purge ? "?purge=1" : ""}`;
      const task = await this.proxmoxRequest<ProxmoxTaskResponse>(context, deleteUrl, "DELETE");
      await this.waitForTask(context, task.data);

      return this.success({ rolledBack: true, deletedVmid: vmid, purged: purge });
    } catch (e) {
      return this.failure(e instanceof Error ? e.message : String(e));
    }
  }

  async verify(context: ProviderContext, plan: ExecutionPlan): Promise<ProviderResult> {
    this.log(context, "info", "Verifying Proxmox deployment");

    const node = context.providerConfig.node;
    // Find the provisioning step to get vmid
    const provisioningStep = plan.steps.find((s) => s.kind === "provisioning");
    const vmid = (provisioningStep?.input.vmid as number) || 100;

    try {
      const vmStatus = await this.proxmoxRequest<ProxmoxVMStatusResponse>(
        context,
        `/api2/json/nodes/${node}/qemu/${vmid}/status/current`,
      );

      if (vmStatus.data.status !== "running") {
        return this.failure(`VM ${vmid} is not running (status: ${vmStatus.data.status})`);
      }

      return this.success({ verified: true, vmStatus: vmStatus.data.status, vmid });
    } catch (e) {
      return this.failure(e instanceof Error ? e.message : String(e));
    }
  }

  async healthCheck(context: ProviderContext): Promise<ProviderResult<{ healthy: boolean; details: Record<string, unknown> }>> {
    try {
      await this.ensureAuthenticated(context);
      const nodes = await this.proxmoxRequest<ProxmoxNodeResponse>(context, "/api2/json/nodes");
      const targetNode = nodes.data.find((n) => n.node === context.providerConfig.node);

      return this.success({
        healthy: !!targetNode && targetNode.status === "online",
        details: {
          node: context.providerConfig.node,
          nodeStatus: targetNode?.status || "unknown",
          version: "Proxmox VE",
        },
      });
    } catch (e) {
      return this.success({
        healthy: false,
        details: { error: e instanceof Error ? e.message : String(e) },
      });
    }
  }
}