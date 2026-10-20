import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Next.js 16 names this file "proxy" (formerly "middleware").
export default createMiddleware(routing);

export const config = {
  // Skip API routes, Next internals and static files.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
