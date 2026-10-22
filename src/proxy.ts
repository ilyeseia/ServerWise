import createMiddleware from "next-intl/middleware";
import { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { buildCsp } from "./server/security/csp";

// Next.js 16 names this file "proxy" (formerly "middleware").
const intl = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  // A fresh nonce per request: Next.js reads it from the request's CSP header and stamps its own
  // scripts with it, so no inline script is allowed without it.
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce, process.env.NODE_ENV !== "production");
  const headers = new Headers(request.headers);
  headers.set("content-security-policy", csp);
  headers.set("x-nonce", nonce);
  const response = intl(new NextRequest(request, { headers }));
  response.headers.set("content-security-policy", csp);
  forwardRequestHeaders(response, { "content-security-policy": csp, "x-nonce": nonce });
  return response;
}

/**
 * next-intl builds its own response, which would not carry our request headers on to the page
 * render. Next.js forwards request headers through these internal response headers, so add ours.
 */
function forwardRequestHeaders(response: Response, extra: Record<string, string>) {
  const names = new Set(
    (response.headers.get("x-middleware-override-headers") ?? "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean),
  );
  for (const [name, value] of Object.entries(extra)) {
    names.add(name);
    response.headers.set(`x-middleware-request-${name}`, value);
  }
  response.headers.set("x-middleware-override-headers", [...names].join(","));
}

export const config = {
  // Skip API routes, Next internals and static files.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
