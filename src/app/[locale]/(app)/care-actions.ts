"use server";

import { revalidatePath } from "next/cache";
import { createAsset, updateAsset } from "@/modules/careops/assets";
import {
  cancelContract,
  createContract,
  createSchedule,
  generateRemindersNow,
  recordServiceReport,
  updateContract,
  updateSchedule,
} from "@/modules/careops/maintenance";
import type {
  AssetInput,
  ContractInput,
  ScheduleInput,
  ServiceReportInput,
  TicketInput,
  TicketStatusInput,
  TicketUpdateInput,
} from "@/modules/careops/schemas";
import {
  addComment,
  changeTicketStatus,
  createTicket,
  updateTicket,
} from "@/modules/careops/tickets";
import { run, type ActionResult } from "@/server/actions";

const refresh = () => revalidatePath("/", "layout");

/** Runs a service call and refreshes the pages that show care data. */
const act = <T extends object>(body: Parameters<typeof run<T>>[0]) =>
  run(async (ctx) => {
    const result = await body(ctx);
    refresh();
    return result;
  });

// --- assets ---------------------------------------------------------------------------------

export async function createAssetAction(input: AssetInput): Promise<ActionResult<{ id: string }>> {
  return act((ctx) => createAsset(ctx, input));
}

export async function updateAssetAction(id: string, input: AssetInput): Promise<ActionResult> {
  return act(async (ctx) => {
    await updateAsset(ctx, id, input);
    return {};
  });
}

// --- tickets --------------------------------------------------------------------------------

export async function createTicketAction(
  input: TicketInput,
): Promise<ActionResult<{ id: string }>> {
  return act(async (ctx) => {
    const ticket = await createTicket(ctx, input);
    return { id: ticket.id };
  });
}

export async function updateTicketAction(
  id: string,
  input: TicketUpdateInput,
): Promise<ActionResult> {
  return act(async (ctx) => {
    await updateTicket(ctx, id, input);
    return {};
  });
}

export async function changeTicketStatusAction(
  id: string,
  input: TicketStatusInput,
): Promise<ActionResult> {
  return act(async (ctx) => {
    await changeTicketStatus(ctx, id, input);
    return {};
  });
}

export async function addCommentAction(ticketId: string, body: string): Promise<ActionResult> {
  return act(async (ctx) => {
    await addComment(ctx, ticketId, body);
    return {};
  });
}

// --- maintenance ----------------------------------------------------------------------------

export async function createContractAction(
  input: ContractInput,
): Promise<ActionResult<{ id: string }>> {
  return act((ctx) => createContract(ctx, input));
}

export async function updateContractAction(
  id: string,
  input: ContractInput,
): Promise<ActionResult> {
  return act(async (ctx) => {
    await updateContract(ctx, id, input);
    return {};
  });
}

export async function cancelContractAction(id: string, reason: string): Promise<ActionResult> {
  return act(async (ctx) => {
    await cancelContract(ctx, id, reason);
    return {};
  });
}

export async function createScheduleAction(
  contractId: string,
  input: ScheduleInput,
): Promise<ActionResult> {
  return act(async (ctx) => {
    await createSchedule(ctx, contractId, input);
    return {};
  });
}

export async function updateScheduleAction(
  id: string,
  input: ScheduleInput,
): Promise<ActionResult> {
  return act(async (ctx) => {
    await updateSchedule(ctx, id, input);
    return {};
  });
}

export async function recordServiceReportAction(input: ServiceReportInput): Promise<ActionResult> {
  return act(async (ctx) => {
    await recordServiceReport(ctx, input);
    return {};
  });
}

export async function generateRemindersAction(): Promise<
  ActionResult<{ created: number; alreadyRaised: number }>
> {
  return act((ctx) => generateRemindersNow(ctx));
}
