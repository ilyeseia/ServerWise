import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getCompanySettings, updateCompanySettings } from "@/modules/settings/service";
import { createUser, listUsers, setUserRole } from "@/modules/users/service";
import { listAudit, recordAudit } from "@/server/audit";
import { ForbiddenError, UnauthorizedError } from "@/server/authz/guard";
import { ROLES } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";
import { createTestUser, deleteTestUsers, sessionFor, signIn, type TestUser } from "./helpers";

const users: TestUser[] = [];
const sessions = new Map<string, Awaited<ReturnType<typeof sessionFor>>>();
const headersByRole = new Map<string, Headers>();
let originalCompany: Awaited<ReturnType<typeof getCompanySettings>> | undefined;

describe.skipIf(!process.env.DATABASE_URL)("services with real sessions (integration)", () => {
  beforeAll(async () => {
    for (const role of ROLES) {
      const user = await createTestUser(role);
      users.push(user);
      const headers = await signIn(user.email, user.password);
      headersByRole.set(role, headers);
      sessions.set(role, await sessionFor(headers));
    }
    const owner = sessions.get("owner");
    originalCompany = await getCompanySettings(owner?.actor);
  });

  afterAll(async () => {
    // Restore whatever the developer had configured before the tests ran.
    if (originalCompany) await updateCompanySettings(sessions.get("owner")?.actor, originalCompany);
    await deleteTestUsers(users);
    await getDb().$disconnect();
  });

  const actorOf = (role: string) => sessions.get(role)?.actor;
  const headersOf = (role: string) => headersByRole.get(role) as Headers;

  describe("authorization matrix against real sessions", () => {
    it("only the owner can list users", async () => {
      expect(
        (await listUsers({ actor: actorOf("owner"), headers: headersOf("owner") })).length,
      ).toBeGreaterThan(0);
      for (const role of ["sales", "technician", "viewer"]) {
        await expect(
          listUsers({ actor: actorOf(role), headers: headersOf(role) }),
        ).rejects.toBeInstanceOf(ForbiddenError);
      }
      await expect(listUsers({ actor: undefined, headers: new Headers() })).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
    });

    it("only the owner can read the audit log", async () => {
      expect(Array.isArray(await listAudit(actorOf("owner")))).toBe(true);
      for (const role of ["sales", "technician", "viewer"]) {
        await expect(listAudit(actorOf(role))).rejects.toBeInstanceOf(ForbiddenError);
      }
      await expect(listAudit(null)).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it("a non-owner session cannot reach Better Auth's admin API even if the service were bypassed", async () => {
      const { getAuth } = await import("@/server/auth");
      const target = users.find((u) => u.role === "viewer")!;
      await expect(
        getAuth().api.setRole({
          body: { userId: target.id, role: "owner" },
          headers: headersOf("sales"),
        }),
      ).rejects.toBeTruthy();
      const row = await getDb().user.findUniqueOrThrow({ where: { id: target.id } });
      expect(row.role).toBe("viewer");
    });

    it("an owner can change another user's role, and it is audited", async () => {
      const target = users.find((u) => u.role === "viewer")!;
      await setUserRole(
        { actor: actorOf("owner"), headers: headersOf("owner") },
        target.id,
        "technician",
      );
      expect((await getDb().user.findUniqueOrThrow({ where: { id: target.id } })).role).toBe(
        "technician",
      );
      const rows = await getDb().auditLog.findMany({
        where: { action: "user.role_changed", entityId: target.id },
      });
      expect(rows.length).toBe(1);
      expect(rows[0]?.actorEmail).toBe(users.find((u) => u.role === "owner")!.email);
    });

    it("never exposes password hashes or tokens through the user list", async () => {
      const list = await listUsers({ actor: actorOf("owner"), headers: headersOf("owner") });
      // Field names (not values): "mustChangePassword" is a harmless flag, a "password" key is not.
      for (const row of list) {
        const keys = Object.keys(row).join(",");
        expect(keys).not.toMatch(/(^|,)(password|passwordHash|hash|token|secret)(,|$)/i);
      }
      expect(JSON.stringify(list)).not.toMatch(/scrypt|\$argon|"[0-9a-f]{64,}"/i);
    });

    it("createUser through the service produces a working, audited account", async () => {
      const email = `svc-${crypto.randomUUID().slice(0, 8)}@example.test`;
      const { user, temporaryPassword } = await createUser(
        { actor: actorOf("owner"), headers: headersOf("owner") },
        { name: "Service Created", email, role: "viewer" },
      );
      users.push({ id: user.id, email, password: temporaryPassword, role: "viewer" });
      expect(user.mustChangePassword).toBe(true);
      expect((await sessionFor(await signIn(email, temporaryPassword)))?.actor.role).toBe("viewer");
    });
  });

  describe("settings", () => {
    it("every role can read; only the owner can write", async () => {
      for (const role of ROLES.filter((r) => r !== "viewer")) {
        await expect(getCompanySettings(actorOf(role))).resolves.toBeTruthy();
      }
      await expect(getCompanySettings(actorOf("viewer"))).rejects.toBeInstanceOf(ForbiddenError);

      const input = { name: "ACME Servers", phone: "0555 00 00 00", address: "Sétif" };
      for (const role of ["sales", "technician", "viewer"]) {
        await expect(updateCompanySettings(actorOf(role), input)).rejects.toBeInstanceOf(
          ForbiddenError,
        );
      }
      await expect(updateCompanySettings(null, input)).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it("validates input, stores it, and writes an audit row in the same transaction", async () => {
      const owner = actorOf("owner");
      await expect(
        updateCompanySettings(owner, { name: "x".repeat(500), phone: "", address: "" }),
      ).rejects.toThrow();

      const before = await getDb().auditLog.count({
        where: { action: "settings.updated", actorEmail: owner!.email },
      });
      const saved = await updateCompanySettings(
        owner,
        { name: "  ACME Servers  ", phone: "0555", address: "Sétif" },
        { ip: "203.0.113.9", userAgent: "vitest" },
      );
      expect(saved.name).toBe("ACME Servers"); // trimmed
      expect((await getCompanySettings(owner)).name).toBe("ACME Servers");

      const rows = await getDb().auditLog.findMany({
        where: { action: "settings.updated", actorEmail: owner!.email },
        orderBy: { createdAt: "desc" },
      });
      expect(rows.length).toBe(before + 1);
      expect(rows[0]).toMatchObject({
        entityType: "setting",
        entityId: "company",
        ip: "203.0.113.9",
      });
      expect((rows[0]?.metadata as { changed: string[] }).changed).toContain("name");
    });
  });

  describe("audit log immutability", () => {
    it("rejects UPDATE, DELETE and TRUNCATE at the database level", async () => {
      const db = getDb();
      await recordAudit({ action: "auth.logout", actorEmail: "immutability@example.test" });
      const row = await db.auditLog.findFirstOrThrow({
        where: { actorEmail: "immutability@example.test" },
      });

      await expect(
        db.auditLog.update({ where: { id: row.id }, data: { action: "auth.login.success" } }),
      ).rejects.toThrow(/append-only/);
      await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
      await expect(db.$executeRawUnsafe(`TRUNCATE TABLE "audit_log"`)).rejects.toThrow(
        /append-only/,
      );
      await expect(db.auditLog.deleteMany({})).rejects.toThrow(/append-only/);

      expect(await db.auditLog.findUnique({ where: { id: row.id } })).not.toBeNull();
    });
  });
});
