"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { ZodError } from "zod";
import { updatePricing } from "@/modules/quotes/pricing";
import { updateCompanySettings } from "@/modules/settings/service";
import { run, type ActionResult } from "@/server/actions";
import { clientInfo } from "@/server/audit";
import { getSessionInfo } from "@/server/auth/session";
import { ForbiddenError, UnauthorizedError } from "@/server/authz/guard";
import { logger } from "@/server/logging/logger";

export type SettingsResult =
  { ok: true } | { ok: false; code: "validation" | "forbidden" | "unknown" };

export async function saveCompanyAction(input: {
  name: string;
  phone: string;
  address: string;
}): Promise<SettingsResult> {
  try {
    const requestHeaders = await headers();
    const session = await getSessionInfo(requestHeaders);
    await updateCompanySettings(session?.actor, input, clientInfo(requestHeaders));
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, code: "validation" };
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
      return { ok: false, code: "forbidden" };
    }
    logger.error({ err: error }, "saving settings failed");
    return { ok: false, code: "unknown" };
  }
}

export async function savePricingAction(input: unknown): Promise<ActionResult> {
  return run(async (ctx) => {
    await updatePricing(ctx, input);
    revalidatePath("/", "layout");
    return {};
  });
}
