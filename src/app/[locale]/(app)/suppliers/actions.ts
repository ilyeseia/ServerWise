"use server";

import { revalidatePath } from "next/cache";
import type { SupplierInput } from "@/modules/catalog/schemas";
import { createSupplier, setSupplierActive, updateSupplier } from "@/modules/catalog/suppliers";
import { run, type ActionResult } from "@/server/actions";

const refresh = () => revalidatePath("/", "layout");

export async function createSupplierAction(input: SupplierInput): Promise<ActionResult> {
  return run(async (ctx) => {
    await createSupplier(ctx, input);
    refresh();
    return {};
  });
}

export async function updateSupplierAction(
  id: string,
  input: SupplierInput,
): Promise<ActionResult> {
  return run(async (ctx) => {
    await updateSupplier(ctx, id, input);
    refresh();
    return {};
  });
}

export async function setSupplierActiveAction(id: string, active: boolean): Promise<ActionResult> {
  return run(async (ctx) => {
    await setSupplierActive(ctx, id, active);
    refresh();
    return {};
  });
}
