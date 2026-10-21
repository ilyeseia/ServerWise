"use server";

import { revalidatePath } from "next/cache";
import {
  approvePlan,
  createPlan,
  createPolicy,
  markRecoveryReviewed,
  recordBackup,
  recordRestoreTest,
  retirePlan,
  saveRecoveryProcedure,
  updatePlan,
  updatePolicy,
} from "@/modules/backups/service";
import type {
  BackupPolicyInput,
  BackupRecordInput,
  RemotePlanInput,
  RestoreTestInput,
} from "@/modules/backups/schemas";
import { run, type ActionResult } from "@/server/actions";

const refresh = () => revalidatePath("/", "layout");

/** Runs a service call and refreshes the pages that show backup data. */
const act = <T extends object>(body: Parameters<typeof run<T>>[0]) =>
  run(async (ctx) => {
    const result = await body(ctx);
    refresh();
    return result;
  });

export async function createPolicyAction(
  input: BackupPolicyInput,
): Promise<ActionResult<{ id: string }>> {
  return act((ctx) => createPolicy(ctx, input));
}

export async function updatePolicyAction(
  id: string,
  input: BackupPolicyInput,
): Promise<ActionResult> {
  return act(async (ctx) => {
    await updatePolicy(ctx, id, input);
    return {};
  });
}

export async function saveRecoveryAction(id: string, procedure: string): Promise<ActionResult> {
  return act(async (ctx) => {
    await saveRecoveryProcedure(ctx, id, procedure);
    return {};
  });
}

export async function markReviewedAction(id: string): Promise<ActionResult> {
  return act(async (ctx) => {
    await markRecoveryReviewed(ctx, id);
    return {};
  });
}

export async function recordBackupAction(
  policyId: string,
  input: BackupRecordInput,
): Promise<ActionResult> {
  return act(async (ctx) => {
    await recordBackup(ctx, policyId, input);
    return {};
  });
}

export async function recordRestoreTestAction(
  policyId: string,
  input: RestoreTestInput,
): Promise<ActionResult> {
  return act(async (ctx) => {
    await recordRestoreTest(ctx, policyId, input);
    return {};
  });
}

export async function createPlanAction(
  input: RemotePlanInput,
): Promise<ActionResult<{ id: string }>> {
  return act((ctx) => createPlan(ctx, input));
}

export async function updatePlanAction(id: string, input: RemotePlanInput): Promise<ActionResult> {
  return act(async (ctx) => {
    await updatePlan(ctx, id, input);
    return {};
  });
}

export async function approvePlanAction(id: string): Promise<ActionResult> {
  return act(async (ctx) => {
    await approvePlan(ctx, id);
    return {};
  });
}

export async function retirePlanAction(id: string): Promise<ActionResult> {
  return act(async (ctx) => {
    await retirePlan(ctx, id);
    return {};
  });
}
