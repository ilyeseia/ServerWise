import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { checkDatabase } from "@/server/health/checks";

// Requires a migrated PostgreSQL (see compose.dev.yml + `pnpm db:deploy`). CI provides one.
describe.skipIf(!process.env.DATABASE_URL)("database (integration)", () => {
  const key = `test.${crypto.randomUUID()}`;

  afterAll(async () => {
    const db = getDb();
    await db.appSetting.deleteMany({ where: { key } });
    await db.$disconnect();
  });

  it("reports ok on the readiness check", async () => {
    expect(await checkDatabase()).toBe("ok");
  });

  it("persists and updates JSON settings", async () => {
    const db = getDb();
    await db.appSetting.create({ data: { key, value: { currency: "DZD" } } });
    const created = await db.appSetting.findUniqueOrThrow({ where: { key } });
    expect(created.value).toEqual({ currency: "DZD" });

    const updated = await db.appSetting.update({
      where: { key },
      data: { value: { currency: "EUR" } },
    });
    expect(updated.value).toEqual({ currency: "EUR" });
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });

  it("enforces the primary key on duplicate keys", async () => {
    await expect(getDb().appSetting.create({ data: { key, value: {} } })).rejects.toThrow();
  });
});
