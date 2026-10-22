import { describe, expect, it } from "vitest";
import { buildCsp } from "@/server/security/csp";

describe("buildCsp", () => {
  const prod = buildCsp("abc123", false);

  it("allows scripts only from self and the request nonce", () => {
    expect(prod).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(prod).not.toContain("unsafe-eval");
    expect(prod).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("forbids plugins, framing, foreign bases and foreign form targets", () => {
    for (const d of [
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "default-src 'self'",
    ]) {
      expect(prod).toContain(d);
    }
  });

  it("upgrades insecure requests in production only, and allows eval in development only", () => {
    expect(prod).toContain("upgrade-insecure-requests");
    const dev = buildCsp("abc123", true);
    expect(dev).not.toContain("upgrade-insecure-requests");
    expect(dev).toContain("'unsafe-eval'");
  });
});
