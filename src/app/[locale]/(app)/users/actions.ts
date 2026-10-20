"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { ZodError } from "zod";
import {
  createUser,
  resetUserPassword,
  setUserActive,
  setUserRole,
  type ServiceContext,
} from "@/modules/users/service";
import { getSessionInfo } from "@/server/auth/session";
import { ForbiddenError, RuleViolationError, UnauthorizedError } from "@/server/authz/guard";
import { isRole } from "@/server/authz/permissions";
import { logger } from "@/server/logging/logger";

export type ActionResult =
  { ok: true; temporaryPassword?: string; email?: string } | { ok: false; code: string };

async function context(): Promise<ServiceContext> {
  const requestHeaders = await headers();
  const session = await getSessionInfo(requestHeaders);
  return { actor: session?.actor, headers: requestHeaders };
}

function fail(error: unknown): ActionResult {
  if (error instanceof ZodError) return { ok: false, code: "VALIDATION" };
  if (error instanceof UnauthorizedError) return { ok: false, code: "UNAUTHORIZED" };
  if (error instanceof ForbiddenError) return { ok: false, code: "FORBIDDEN" };
  if (error instanceof RuleViolationError) return { ok: false, code: error.code };
  logger.error({ err: error }, "user management action failed");
  return { ok: false, code: "UNKNOWN" };
}

export async function createUserAction(input: {
  name: string;
  email: string;
  role: string;
}): Promise<ActionResult> {
  try {
    const { user, temporaryPassword } = await createUser(await context(), {
      name: input.name,
      email: input.email,
      role: input.role as never, // validated by the service's zod schema
    });
    revalidatePath("/", "layout");
    return { ok: true, temporaryPassword, email: user.email };
  } catch (error) {
    return fail(error);
  }
}

export async function setRoleAction(userId: string, role: string): Promise<ActionResult> {
  try {
    if (!isRole(role)) return { ok: false, code: "INVALID_ROLE" };
    await setUserRole(await context(), userId, role);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function setActiveAction(userId: string, active: boolean): Promise<ActionResult> {
  try {
    await setUserActive(await context(), userId, active);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function resetPasswordAction(userId: string, email: string): Promise<ActionResult> {
  try {
    const { temporaryPassword } = await resetUserPassword(await context(), userId);
    revalidatePath("/", "layout");
    return { ok: true, temporaryPassword, email };
  } catch (error) {
    return fail(error);
  }
}
