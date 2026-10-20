"use server";

import { revalidatePath } from "next/cache";
import { suggestHardwareLine } from "@/modules/quotes/service";
import {
  createQuote,
  createRevision,
  decideRevision,
  issueRevision,
  saveDraft,
} from "@/modules/quotes/service";
import type { CreateQuoteInput, DecideInput, SaveDraftInput } from "@/modules/quotes/schemas";
import { CalcError } from "@/modules/quotes/calc";
import { run, toFailure, type ActionResult } from "@/server/actions";

const refresh = () => revalidatePath("/", "layout");

export async function createQuoteAction(
  input: CreateQuoteInput,
): Promise<ActionResult<{ id: string }>> {
  return run(async (ctx) => {
    const quote = await createQuote(ctx, input);
    refresh();
    return { id: quote.id };
  });
}

export async function saveDraftAction(
  revisionId: string,
  input: SaveDraftInput,
): Promise<ActionResult> {
  try {
    return await run(async (ctx) => {
      await saveDraft(ctx, revisionId, input);
      refresh();
      return {};
    });
  } catch (error) {
    return error instanceof CalcError ? { ok: false, code: "VALIDATION" } : toFailure(error);
  }
}

export async function issueRevisionAction(revisionId: string): Promise<ActionResult> {
  return run(async (ctx) => {
    await issueRevision(ctx, revisionId);
    refresh();
    return {};
  });
}

export async function createRevisionAction(quoteId: string): Promise<ActionResult> {
  return run(async (ctx) => {
    await createRevision(ctx, quoteId);
    refresh();
    return {};
  });
}

export async function decideRevisionAction(
  revisionId: string,
  input: DecideInput,
): Promise<ActionResult> {
  return run(async (ctx) => {
    await decideRevision(ctx, revisionId, input);
    refresh();
    return {};
  });
}

export async function suggestLineAction(productId: string): Promise<
  ActionResult<{
    description: string;
    offerId: string | null;
    costDzd: string | null;
    supplierName: string | null;
    suggestedUnitPrice: string | null;
  }>
> {
  return run(async (ctx) => {
    const s = await suggestHardwareLine(ctx, productId);
    return {
      description: s.description,
      offerId: s.offer?.id ?? null,
      costDzd: s.offer?.costDzd ?? null,
      supplierName: s.offer?.supplierName ?? null,
      suggestedUnitPrice: s.suggestedUnitPrice,
    };
  });
}
