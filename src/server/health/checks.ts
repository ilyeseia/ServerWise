import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { logger } from "@/server/logging/logger";

export type DatabaseStatus = "ok" | "unavailable" | "not_configured";

const DB_CHECK_TIMEOUT_MS = 3000;

/** Checks database connectivity with a short timeout. Never throws. */
export async function checkDatabase(): Promise<DatabaseStatus> {
  if (!getEnv().DATABASE_URL) return "not_configured";

  try {
    await Promise.race([
      getDb().$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("database check timed out")), DB_CHECK_TIMEOUT_MS),
      ),
    ]);
    return "ok";
  } catch (error) {
    logger.warn({ err: error }, "database readiness check failed");
    return "unavailable";
  }
}
