import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness probe: the process is up. Does not touch dependencies. */
export function GET() {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
