import { headers } from "next/headers";
import { ZodError } from "zod";
import type { CrmContext } from "@/modules/crm/context";
import { clientInfo } from "@/server/audit";
import { getSessionInfo } from "@/server/auth/session";
import { ForbiddenError, RuleViolationError, UnauthorizedError } from "@/server/authz/guard";
import { logger } from "@/server/logging/logger";

/** What every server action returns: success data, or an error code the UI translates. */
export type ActionResult<T extends object = object> =
  ({ ok: true } & T) | { ok: false; code: string; fields?: Record<string, string> };

/** The signed-in actor and request origin for a server action. */
export async function actionContext(): Promise<CrmContext> {
  const requestHeaders = await headers();
  const session = await getSessionInfo(requestHeaders);
  return { actor: session?.actor, client: clientInfo(requestHeaders) };
}

/**
 * Converts any thrown error into a safe result. Business-rule errors carry their own code;
 * validation errors report which fields failed; anything else is logged and hidden.
 */
export function toFailure(error: unknown): {
  ok: false;
  code: string;
  fields?: Record<string, string>;
} {
  if (error instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of error.issues) {
      const key = issue.path.join(".") || "_";
      fields[key] ??= issue.message && /^[a-z_]+$/.test(issue.message) ? issue.message : "invalid";
    }
    return { ok: false, code: "VALIDATION", fields };
  }
  if (error instanceof UnauthorizedError) return { ok: false, code: "UNAUTHORIZED" };
  if (error instanceof ForbiddenError) return { ok: false, code: "FORBIDDEN" };
  if (error instanceof RuleViolationError) return { ok: false, code: error.code };
  logger.error({ err: error }, "server action failed");
  return { ok: false, code: "UNKNOWN" };
}

/** Runs an action body and turns failures into results. */
export async function run<T extends object>(
  body: (ctx: CrmContext) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    return { ok: true, ...(await body(await actionContext())) };
  } catch (error) {
    return toFailure(error);
  }
}
