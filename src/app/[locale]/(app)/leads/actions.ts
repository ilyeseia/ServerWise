"use server";

import { revalidatePath } from "next/cache";
import type { LeadStatus } from "@/modules/crm/lead-status";
import { changeLeadStatus, createLead, updateLead } from "@/modules/crm/leads";
import type { LeadInput, LeadUpdateInput } from "@/modules/crm/schemas";
import type { Answers, ValidationCode } from "@/modules/questionnaire/types";
import { saveRequirements } from "@/modules/questionnaire/service";
import { runAdvisorForLead } from "@/modules/advisor/service";
import { run, type ActionResult } from "@/server/actions";

const refresh = () => revalidatePath("/", "layout");

export async function createLeadAction(input: LeadInput): Promise<ActionResult<{ id: string }>> {
  return run(async (ctx) => {
    const lead = await createLead(ctx, input);
    refresh();
    return { id: lead.id };
  });
}

export async function updateLeadAction(id: string, input: LeadUpdateInput): Promise<ActionResult> {
  return run(async (ctx) => {
    await updateLead(ctx, id, input);
    refresh();
    return {};
  });
}

export async function changeLeadStatusAction(
  id: string,
  to: LeadStatus,
  lostReason?: string,
): Promise<ActionResult> {
  return run(async (ctx) => {
    await changeLeadStatus(ctx, id, to, { lostReason });
    refresh();
    return {};
  });
}

export type RequirementsActionResult =
  | { ok: true; status: "draft" | "complete" }
  | { ok: false; code: string; errors?: Record<string, ValidationCode> };

export async function saveRequirementsAction(
  leadId: string,
  answers: Answers,
  complete: boolean,
): Promise<RequirementsActionResult> {
  const result = await run(async (ctx) => {
    const saved = await saveRequirements(ctx, leadId, answers, { complete });
    if (saved.ok) refresh();
    return saved.ok ? { status: saved.status } : { invalid: saved.errors };
  });
  if (!result.ok) return { ok: false, code: result.code };
  if ("invalid" in result) return { ok: false, code: "VALIDATION", errors: result.invalid };
  return { ok: true, status: result.status as "draft" | "complete" };
}

export async function runAdvisorAction(
  leadId: string,
  options: { includeStale: boolean; includeUnverified: boolean },
): Promise<ActionResult<{ id: string }>> {
  return run(async (ctx) => {
    const recommendation = await runAdvisorForLead(ctx, leadId, {
      includeStale: options.includeStale === true,
      includeUnverified: options.includeUnverified === true,
    });
    refresh();
    return { id: recommendation.id };
  });
}
