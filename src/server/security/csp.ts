/**
 * Content-Security-Policy for the pages (pure, unit-tested).
 *
 * Scripts: only same-origin files and those carrying this request's nonce ('strict-dynamic' lets a
 * nonced script load its chunks). Styles keep 'unsafe-inline' because React `style=""` attributes
 * (progress bars) cannot carry a nonce; inline *scripts* are what matters for XSS.
 * `unsafe-eval` is added in development only (React's debugging tools need it).
 */
export function buildCsp(nonce: string, development: boolean): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ];
  return directives.join("; ");
}
