import { getAuth } from "@/server/auth";

export const dynamic = "force-dynamic";

// Created lazily so the production build does not need runtime secrets.
export function GET(request: Request) {
  return getAuth().handler(request);
}

export function POST(request: Request) {
  return getAuth().handler(request);
}
