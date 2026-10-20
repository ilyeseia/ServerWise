import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test: in production getDb() used to build a new PrismaClient (and connection pool)
 * on every call, which exhausted PostgreSQL's connections under load.
 */
describe("getDb", () => {
  const globalWithPrisma = globalThis as unknown as { prisma?: unknown };

  beforeEach(() => {
    vi.resetModules();
    delete globalWithPrisma.prisma;
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/unused");
    vi.stubEnv("AUTH_SECRET", "x".repeat(40));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete globalWithPrisma.prisma;
  });

  for (const nodeEnv of ["production", "development", "test"]) {
    it(`returns the same client on every call in ${nodeEnv}`, async () => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      const { getDb } = await import("@/server/db/client");
      const first = getDb();
      expect(getDb()).toBe(first);
      expect(getDb()).toBe(first);
    });
  }

  it("shares the client across module instances (hot reload / several bundles)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { getDb: first } = await import("@/server/db/client");
    const client = first();
    vi.resetModules();
    const { getDb: second } = await import("@/server/db/client");
    expect(second()).toBe(client);
  });

  it("refuses to run without a database URL", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const { getDb } = await import("@/server/db/client");
    expect(() => getDb()).toThrow(/DATABASE_URL/);
  });
});
