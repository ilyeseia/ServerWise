import { NextResponse } from "next/server";
import { checkDatabase } from "@/server/health/checks";

export const dynamic = "force-dynamic";

/** Readiness probe: the app can serve traffic (database reachable). */
export async function GET() {
  const database = await checkDatabase();
  const ready = database === "ok";
  return NextResponse.json(
    { status: ready ? "ready" : "not_ready", checks: { database } },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
