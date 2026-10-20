import { describe, expect, it } from "vitest";
import {
  GENERIC_LOGIN_ERROR,
  LOCKOUT_MINUTES,
  MAX_FAILED_LOGINS,
  generateTemporaryPassword,
} from "@/server/auth/policy";
import { accessGate, type SessionInfo } from "@/server/auth/session";
import type { Role } from "@/server/authz/permissions";

describe("generateTemporaryPassword", () => {
  it("meets the strength rules every time", () => {
    for (let i = 0; i < 200; i++) {
      const p = generateTemporaryPassword();
      expect(p).toHaveLength(16);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[2-9]/);
      expect(p).toMatch(/[-_!@#%+=]/);
      expect(p).not.toMatch(/[lIO01]/); // no look-alikes
    }
  });

  it("is not repeated across calls", () => {
    const set = new Set(Array.from({ length: 500 }, () => generateTemporaryPassword()));
    expect(set.size).toBe(500);
  });
});

describe("lockout policy constants", () => {
  it("lock after a small number of attempts for a bounded time", () => {
    expect(MAX_FAILED_LOGINS).toBeGreaterThanOrEqual(3);
    expect(MAX_FAILED_LOGINS).toBeLessThanOrEqual(10);
    expect(LOCKOUT_MINUTES).toBeGreaterThanOrEqual(5);
    expect(GENERIC_LOGIN_ERROR).not.toMatch(/lock|exist|unknown/i);
  });
});

const session = (role: Role, over: Partial<SessionInfo> = {}): SessionInfo => ({
  actor: { id: "1", email: "a@example.test", name: "A", role },
  mustChangePassword: false,
  twoFactorEnabled: false,
  ...over,
});

describe("accessGate", () => {
  it("forces a password change first, for every role", () => {
    for (const role of ["owner", "sales", "technician", "viewer"] as const) {
      expect(
        accessGate(session(role, { mustChangePassword: true }), { require2faForOwner: true }),
      ).toBe("change-password");
    }
  });

  it("requires 2FA only for owners, and only when the policy is on", () => {
    expect(accessGate(session("owner"), { require2faForOwner: true })).toBe("enroll-2fa");
    expect(accessGate(session("owner"), { require2faForOwner: false })).toBe("ok");
    expect(
      accessGate(session("owner", { twoFactorEnabled: true }), { require2faForOwner: true }),
    ).toBe("ok");
    expect(accessGate(session("sales"), { require2faForOwner: true })).toBe("ok");
  });

  it("checks the password change before the 2FA enrolment", () => {
    expect(
      accessGate(session("owner", { mustChangePassword: true }), { require2faForOwner: true }),
    ).toBe("change-password");
  });
});
