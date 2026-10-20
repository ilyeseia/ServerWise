"use server";

import { revalidatePath } from "next/cache";
import { decideOffer, recordOffer } from "@/modules/catalog/offers";
import { createProduct, setProductActive, updateProduct } from "@/modules/catalog/products";
import type { OfferInput, ProductInput } from "@/modules/catalog/schemas";
import { run, type ActionResult } from "@/server/actions";

const refresh = () => revalidatePath("/", "layout");

export async function createProductAction(
  input: ProductInput,
): Promise<ActionResult<{ id: string }>> {
  return run(async (ctx) => {
    const product = await createProduct(ctx, input);
    refresh();
    return { id: product.id };
  });
}

export async function updateProductAction(id: string, input: ProductInput): Promise<ActionResult> {
  return run(async (ctx) => {
    await updateProduct(ctx, id, input);
    refresh();
    return {};
  });
}

export async function setProductActiveAction(id: string, active: boolean): Promise<ActionResult> {
  return run(async (ctx) => {
    await setProductActive(ctx, id, active);
    refresh();
    return {};
  });
}

export async function recordOfferAction(input: OfferInput): Promise<ActionResult> {
  return run(async (ctx) => {
    await recordOffer(ctx, input);
    refresh();
    return {};
  });
}

export async function decideOfferAction(
  offerId: string,
  decision: "verified" | "rejected",
): Promise<ActionResult> {
  return run(async (ctx) => {
    await decideOffer(ctx, offerId, decision);
    refresh();
    return {};
  });
}
