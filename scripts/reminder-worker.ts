/**
 * Raises follow-ups for maintenance visits that are overdue or due soon.
 *
 *   pnpm worker:reminders           run forever (the Compose `worker` service)
 *   pnpm worker:reminders --once    run a single pass and exit
 *
 * Every pass is idempotent (one reminder per schedule and due date), so running it twice, or from
 * two processes at once, never creates duplicates. The interval is REMINDER_INTERVAL_MINUTES
 * (default 60).
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { generateDueReminders } from "@/modules/careops/maintenance";
import { getDb } from "@/server/db/client";
import { logger } from "@/server/logging/logger";

const intervalMinutes = Math.max(1, Number(process.env.REMINDER_INTERVAL_MINUTES ?? "60") || 60);

async function pass() {
  try {
    const result = await generateDueReminders();
    logger.info(result, "maintenance reminders generated");
  } catch (error) {
    // Never let one failed pass stop the worker: the next pass retries.
    logger.error({ err: error }, "maintenance reminder pass failed");
  }
}

async function main() {
  const { values } = parseArgs({ options: { once: { type: "boolean", default: false } } });
  if (values.once) {
    await pass();
    await getDb().$disconnect();
    return;
  }

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  logger.info({ intervalMinutes }, "reminder worker started");
  while (!stopping) {
    await pass();
    // Sleep in short steps so a stop signal is honoured within a second.
    for (let waited = 0; waited < intervalMinutes * 60 && !stopping; waited++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  await getDb().$disconnect();
  logger.info("reminder worker stopped");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
