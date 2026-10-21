"use server";

import { runAiTool, type AiResult } from "@/modules/ai/gateway";
import { run, type ActionResult } from "@/server/actions";

/**
 * Runs one assistant tool as the signed-in user. The result is data for the screen: the assistant
 * never saves anything, so this action does not refresh any page.
 */
export async function runAiToolAction(
  tool: string,
  input: Record<string, unknown>,
): Promise<ActionResult<{ result: AiResult }>> {
  return run(async (ctx) => ({ result: await runAiTool(ctx, tool, input) }));
}
