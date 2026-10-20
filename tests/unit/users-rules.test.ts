import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, RuleViolationError, UnauthorizedError } from "@/server/authz/guard";
import type { Actor } from "@/server/authz/guard";
import { ROLES, type Role } from "@/server/authz/permissions";

// The service's business rules are tested in isolation: database and Better Auth are mocked.
const db = {
  user: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), findUniqueOrThrow: vi.fn() },
};
const api = {
  createUser: vi.fn(),
  setRole: vi.fn(),
  banUser: vi.fn(),
  unbanUser: vi.fn(),
  setUserPassword: vi.fn(),
};

vi.mock("@/server/db/client", () => ({ getDb: () => db }));
vi.mock("@/server/auth", () => ({ getAuth: () => ({ api }) }));

const { createUser, listUsers, resetUserPassword, setUserActive, setUserRole } =
  await import("@/modules/users/service");

const headers = new Headers();
const actor = (role: Role, id = "actor"): Actor => ({
  id,
  email: `${id}@example.test`,
  name: id,
  role,
});
const ctx = (role: Role | null) => ({ actor: role ? actor(role) : null, headers });
const target = (over: Record<string, unknown> = {}) => ({
  id: "target",
  name: "Target",
  email: "target@example.test",
  role: "viewer",
  banned: false,
  twoFactorEnabled: false,
  mustChangePassword: false,
  lockedUntil: null,
  createdAt: new Date(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue(target());
  db.user.findMany.mockResolvedValue([]);
  db.user.count.mockResolvedValue(1);
  db.user.findUniqueOrThrow.mockResolvedValue(target());
});

type Call = (c: ReturnType<typeof ctx>) => Promise<unknown>;
const operations: Record<string, Call> = {
  listUsers: (c) => listUsers(c),
  createUser: (c) => createUser(c, { name: "New User", email: "new@example.test", role: "viewer" }),
  setUserRole: (c) => setUserRole(c, "target", "sales"),
  setUserActive: (c) => setUserActive(c, "target", false),
  resetUserPassword: (c) => resetUserPassword(c, "target"),
};

describe("every user-management operation is guarded", () => {
  for (const [name, call] of Object.entries(operations)) {
    it(`${name}: rejects anonymous callers`, async () => {
      await expect(call(ctx(null))).rejects.toBeInstanceOf(UnauthorizedError);
      expect(Object.values(api).every((f) => f.mock.calls.length === 0)).toBe(true);
    });

    for (const role of ROLES.filter((r) => r !== "owner")) {
      it(`${name}: rejects ${role}`, async () => {
        await expect(call(ctx(role))).rejects.toBeInstanceOf(ForbiddenError);
        expect(Object.values(api).every((f) => f.mock.calls.length === 0)).toBe(true);
      });
    }

    it(`${name}: allows owner`, async () => {
      // createUser first checks that the email is free.
      if (name === "createUser") db.user.findUnique.mockResolvedValueOnce(null);
      await expect(call(ctx("owner"))).resolves.not.toThrow();
    });
  }
});

describe("business rules", () => {
  it("refuses duplicate emails before touching Better Auth", async () => {
    await expect(
      createUser(ctx("owner"), { name: "Dup", email: "Target@Example.test", role: "viewer" }),
    ).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
    expect(api.createUser).not.toHaveBeenCalled();
  });

  it("normalizes the email and returns a one-time temporary password", async () => {
    db.user.findUnique.mockResolvedValueOnce(null);
    const result = await createUser(ctx("owner"), {
      name: "  New  ",
      email: " NEW@Example.TEST ",
      role: "sales",
    });
    expect(api.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ email: "new@example.test", name: "New", role: "sales" }),
      }),
    );
    expect(result.temporaryPassword).toHaveLength(16);
  });

  it("rejects invalid input with a validation error", async () => {
    await expect(
      createUser(ctx("owner"), { name: "x", email: "nope", role: "viewer" }),
    ).rejects.toThrow();
    await expect(
      createUser(ctx("owner"), {
        name: "Valid Name",
        email: "a@example.test",
        role: "root" as Role,
      }),
    ).rejects.toThrow();
  });

  it("does not let an owner change or deactivate themselves", async () => {
    const self = { actor: actor("owner", "me"), headers };
    await expect(setUserRole(self, "me", "viewer")).rejects.toMatchObject({ code: "SELF_CHANGE" });
    await expect(setUserActive(self, "me", false)).rejects.toMatchObject({ code: "SELF_CHANGE" });
    expect(api.setRole).not.toHaveBeenCalled();
    expect(api.banUser).not.toHaveBeenCalled();
  });

  it("keeps at least one active owner (demotion)", async () => {
    db.user.findUnique.mockResolvedValue(target({ role: "owner" }));
    db.user.count.mockResolvedValue(0); // no other active owner
    await expect(setUserRole(ctx("owner"), "target", "sales")).rejects.toMatchObject({
      code: "LAST_OWNER",
    });
    expect(api.setRole).not.toHaveBeenCalled();
  });

  it("keeps at least one active owner (deactivation)", async () => {
    db.user.findUnique.mockResolvedValue(target({ role: "owner" }));
    db.user.count.mockResolvedValue(0);
    await expect(setUserActive(ctx("owner"), "target", false)).rejects.toMatchObject({
      code: "LAST_OWNER",
    });
    expect(api.banUser).not.toHaveBeenCalled();
  });

  it("allows demoting an owner when another active owner remains", async () => {
    db.user.findUnique.mockResolvedValue(target({ role: "owner" }));
    db.user.count.mockResolvedValue(1);
    await setUserRole(ctx("owner"), "target", "sales");
    expect(api.setRole).toHaveBeenCalledWith(
      expect.objectContaining({ body: { userId: "target", role: "sales" } }),
    );
  });

  it("reports unknown targets", async () => {
    db.user.findUnique.mockResolvedValue(null);
    await expect(setUserRole(ctx("owner"), "ghost", "sales")).rejects.toBeInstanceOf(
      RuleViolationError,
    );
    await expect(resetUserPassword(ctx("owner"), "ghost")).rejects.toMatchObject({
      code: "USER_NOT_FOUND",
    });
  });

  it("reactivates through unbanUser", async () => {
    await setUserActive(ctx("owner"), "target", true);
    expect(api.unbanUser).toHaveBeenCalled();
    expect(api.banUser).not.toHaveBeenCalled();
  });

  it("resets a password to a new random value each time", async () => {
    const a = await resetUserPassword(ctx("owner"), "target");
    const b = await resetUserPassword(ctx("owner"), "target");
    expect(a.temporaryPassword).not.toBe(b.temporaryPassword);
    expect(api.setUserPassword).toHaveBeenCalledTimes(2);
  });
});
