"use server";

import { revalidatePath } from "next/cache";
import {
  cancelFollowUp,
  completeFollowUp,
  createFollowUp,
  reopenFollowUp,
} from "@/modules/crm/followups";
import type { FollowUpInput } from "@/modules/crm/schemas";
import { run, type ActionResult } from "@/server/actions";

const refresh = () => revalidatePath("/", "layout");

export async function createFollowUpAction(input: FollowUpInput): Promise<ActionResult> {
  return run(async (ctx) => {
    await createFollowUp(ctx, input);
    refresh();
    return {};
  });
}

export async function completeFollowUpAction(id: string): Promise<ActionResult> {
  return run(async (ctx) => {
    await completeFollowUp(ctx, id);
    refresh();
    return {};
  });
}

export async function cancelFollowUpAction(id: string): Promise<ActionResult> {
  return run(async (ctx) => {
    await cancelFollowUp(ctx, id);
    refresh();
    return {};
  });
}

export async function reopenFollowUpAction(id: string): Promise<ActionResult> {
  return run(async (ctx) => {
    await reopenFollowUp(ctx, id);
    refresh();
    return {};
  });
}
