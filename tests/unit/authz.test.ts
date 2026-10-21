import { describe, expect, it } from "vitest";
import { assertCan, ForbiddenError, UnauthorizedError, type Actor } from "@/server/authz/guard";
import {
  can,
  isRole,
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  type Permission,
  type Role,
} from "@/server/authz/permissions";

/**
 * Golden table: the intended access matrix, written out by hand. If someone widens a role in
 * permissions.ts, this test fails until the change is made deliberately here too.
 */
const EXPECTED: Record<Role, Record<Permission, boolean>> = {
  owner: {
    "dashboard:view": true,
    "user:read": true,
    "user:manage": true,
    "settings:read": true,
    "settings:update": true,
    "audit:read": true,
    "crm:read": true,
    "crm:write": true,
    "crm:archive": true,
    "catalog:read": true,
    "catalog:write": true,
    "catalog:verify": true,
    "quote:read": true,
    "quote:write": true,
    "quote:issue": true,
    "quote:decide": true,
    "project:read": true,
    "project:write": true,
    "project:manage": true,
    "asset:read": true,
    "asset:write": true,
    "ticket:read": true,
    "ticket:write": true,
    "maintenance:read": true,
    "maintenance:write": true,
    "maintenance:perform": true,
    "backup:read": true,
    "backup:write": true,
    "backup:record": true,
    "remote:read": true,
    "remote:write": true,
    "remote:approve": true,
    "ai:use": true,
  },
  sales: {
    "dashboard:view": true,
    "user:read": false,
    "user:manage": false,
    "settings:read": true,
    "settings:update": false,
    "audit:read": false,
    "crm:read": true,
    "crm:write": true,
    "crm:archive": false,
    "catalog:read": true,
    "catalog:write": true,
    "catalog:verify": false,
    "quote:read": true,
    "quote:write": true,
    "quote:issue": true,
    "quote:decide": true,
    "project:read": true,
    "project:write": true,
    "project:manage": true,
    "asset:read": true,
    "asset:write": false,
    "ticket:read": true,
    "ticket:write": true,
    "maintenance:read": true,
    "maintenance:write": true,
    "maintenance:perform": false,
    "backup:read": true,
    "backup:write": false,
    "backup:record": false,
    "remote:read": true,
    "remote:write": false,
    "remote:approve": false,
    "ai:use": true,
  },
  technician: {
    "dashboard:view": true,
    "user:read": false,
    "user:manage": false,
    "settings:read": true,
    "settings:update": false,
    "audit:read": false,
    "crm:read": true,
    "crm:write": false,
    "crm:archive": false,
    "catalog:read": true,
    "catalog:write": true,
    "catalog:verify": false,
    "quote:read": true,
    "quote:write": false,
    "quote:issue": false,
    "quote:decide": false,
    "project:read": true,
    "project:write": true,
    "project:manage": false,
    "asset:read": true,
    "asset:write": true,
    "ticket:read": true,
    "ticket:write": true,
    "maintenance:read": true,
    "maintenance:write": false,
    "maintenance:perform": true,
    "backup:read": true,
    "backup:write": true,
    "backup:record": true,
    "remote:read": true,
    "remote:write": true,
    "remote:approve": false,
    "ai:use": true,
  },
  viewer: {
    "dashboard:view": true,
    "user:read": false,
    "user:manage": false,
    "settings:read": false,
    "settings:update": false,
    "audit:read": false,
    "crm:read": false,
    "crm:write": false,
    "crm:archive": false,
    "catalog:read": false,
    "catalog:write": false,
    "catalog:verify": false,
    "quote:read": false,
    "quote:write": false,
    "quote:issue": false,
    "quote:decide": false,
    "project:read": false,
    "project:write": false,
    "project:manage": false,
    "asset:read": false,
    "asset:write": false,
    "ticket:read": false,
    "ticket:write": false,
    "maintenance:read": false,
    "maintenance:write": false,
    "maintenance:perform": false,
    "backup:read": false,
    "backup:write": false,
    "backup:record": false,
    "remote:read": false,
    "remote:write": false,
    "remote:approve": false,
    "ai:use": false,
  },
};

const actorFor = (role: Role): Actor => ({
  id: `id-${role}`,
  email: `${role}@example.test`,
  name: role,
  role,
});

describe("RBAC matrix", () => {
  for (const role of ROLES) {
    for (const permission of PERMISSIONS) {
      it(`${role} ${EXPECTED[role][permission] ? "can" : "cannot"} ${permission}`, () => {
        expect(can(role, permission)).toBe(EXPECTED[role][permission]);
      });
    }
  }

  it("covers every role and permission in the golden table", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...ROLES].sort());
    for (const role of ROLES) {
      expect(Object.keys(EXPECTED[role]).sort()).toEqual([...PERMISSIONS].sort());
      expect([...ROLE_PERMISSIONS[role]].sort()).toEqual(
        PERMISSIONS.filter((p) => EXPECTED[role][p]).sort(),
      );
    }
  });

  it("denies unknown, empty and malformed roles", () => {
    for (const bad of [undefined, null, "", "admin", "OWNER", "owner ", 0, {}, ["owner"]]) {
      expect(isRole(bad)).toBe(false);
      for (const p of PERMISSIONS) expect(can(bad, p)).toBe(false);
    }
  });

  it("only owners manage users, settings and read the audit log", () => {
    for (const role of ROLES.filter((r) => r !== "owner")) {
      expect(can(role, "user:manage")).toBe(false);
      expect(can(role, "settings:update")).toBe(false);
      expect(can(role, "audit:read")).toBe(false);
    }
  });
});

describe("assertCan", () => {
  it("rejects a missing actor as unauthenticated", () => {
    expect(() => assertCan(null, "dashboard:view")).toThrow(UnauthorizedError);
    expect(() => assertCan(undefined, "dashboard:view")).toThrow(UnauthorizedError);
  });

  it("rejects an actor without the permission as forbidden", () => {
    expect(() => assertCan(actorFor("viewer"), "user:manage")).toThrow(ForbiddenError);
  });

  it("rejects an actor whose role was tampered with", () => {
    const forged = { ...actorFor("viewer"), role: "owner " as unknown as Role };
    expect(() => assertCan(forged, "user:manage")).toThrow(ForbiddenError);
  });

  it("allows an actor with the permission", () => {
    expect(() => assertCan(actorFor("owner"), "user:manage")).not.toThrow();
  });
});
