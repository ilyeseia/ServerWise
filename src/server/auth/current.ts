import { headers } from "next/headers";
import { cache } from "react";
import { getSessionInfo } from "./session";

/** Session for the current server-rendered request (memoized per request). */
export const getCurrentSession = cache(async () => getSessionInfo(await headers()));
