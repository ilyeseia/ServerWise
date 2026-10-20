import { expect, test } from "@playwright/test";

test("liveness endpoint answers without dependencies", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
  expect(res.headers()["cache-control"]).toBe("no-store");
});

test("readiness endpoint reports database state and never leaks details", async ({ request }) => {
  const res = await request.get("/api/ready");
  const body = await res.json();
  expect([200, 503]).toContain(res.status());
  expect(["ok", "unavailable", "not_configured"]).toContain(body.checks.database);
  expect(JSON.stringify(body)).not.toMatch(/postgres(ql)?:\/\//);
});

test("security headers are present", async ({ request }) => {
  const res = await request.get("/api/health");
  const h = res.headers();
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["x-powered-by"]).toBeUndefined();
});
