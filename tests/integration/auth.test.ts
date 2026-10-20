import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAuth } from "@/server/auth";
import { LOCKOUT_MINUTES, MAX_FAILED_LOGINS } from "@/server/auth/policy";
import { getDb } from "@/server/db/client";
import {
  auditFor,
  cookieHeaders,
  createTestUser,
  deleteTestUsers,
  sessionFor,
  signIn,
  totp,
  type TestUser,
} from "./helpers";

const origin = process.env.APP_URL ?? "http://localhost:3000";
const created: TestUser[] = [];
const track = async (...args: Parameters<typeof createTestUser>) => {
  const user = await createTestUser(...args);
  created.push(user);
  return user;
};

async function expectRejected(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) =>
      e as { status?: string | number; message?: string; body?: { message?: string } },
  );
  expect(error, "expected the call to be rejected").not.toBeNull();
  return error as { message?: string; body?: { message?: string } };
}

describe.skipIf(!process.env.DATABASE_URL)("authentication (integration)", () => {
  beforeAll(() => {
    // Warm up: first call builds the Better Auth instance.
    getAuth();
  });

  afterAll(async () => {
    await deleteTestUsers(created);
    await getDb().$disconnect();
  });

  it("signs in with the right password and reports the role", async () => {
    const owner = await track("owner");
    const headers = await signIn(owner.email, owner.password);
    const session = await sessionFor(headers);
    expect(session?.actor).toMatchObject({ id: owner.id, email: owner.email, role: "owner" });
    expect(session?.mustChangePassword).toBe(false);
    expect((await auditFor(owner.email, "auth.login.success")).length).toBe(1);
  });

  it("rejects a wrong password, audits it, and counts the failure", async () => {
    const user = await track("sales");
    await expectRejected(
      getAuth().api.signInEmail({ body: { email: user.email, password: "definitely-wrong-123" } }),
    );
    expect((await auditFor(user.email, "auth.login.failed")).length).toBe(1);
    const row = await getDb().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.failedLoginCount).toBe(1);
    expect(row.lockedUntil).toBeNull();
  });

  it("answers identically for unknown emails and wrong passwords (no enumeration)", async () => {
    const user = await track("viewer");
    const wrong = await expectRejected(
      getAuth().api.signInEmail({ body: { email: user.email, password: "wrong-password-xyz" } }),
    );
    const unknown = await expectRejected(
      getAuth().api.signInEmail({
        body: {
          email: `ghost-${crypto.randomUUID()}@example.test`,
          password: "wrong-password-xyz",
        },
      }),
    );
    expect(unknown.message).toBe(wrong.message);
  });

  it("locks the account after repeated failures, even for the correct password", async () => {
    const user = await track("technician");
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await expectRejected(
        getAuth().api.signInEmail({ body: { email: user.email, password: `wrong-${i}-password` } }),
      );
    }
    const locked = await getDb().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(locked.lockedUntil).not.toBeNull();
    const minutes = (locked.lockedUntil!.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(LOCKOUT_MINUTES - 1);
    expect(minutes).toBeLessThanOrEqual(LOCKOUT_MINUTES);
    expect((await auditFor(user.email, "auth.lockout")).length).toBe(1);

    // The correct password is refused while locked, with the same generic message.
    const blocked = await expectRejected(
      getAuth().api.signInEmail({ body: { email: user.email, password: user.password } }),
    );
    expect(blocked.message).toMatch(/invalid email or password/i);
    expect((await auditFor(user.email, "auth.login.blocked")).length).toBe(1);

    // Once the lock expires, the correct password works and the counters reset.
    await getDb().user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    const headers = await signIn(user.email, user.password);
    expect((await sessionFor(headers))?.actor.id).toBe(user.id);
    const reset = await getDb().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(reset.failedLoginCount).toBe(0);
    expect(reset.lockedUntil).toBeNull();
  });

  it("refuses deactivated users and ends their sessions", async () => {
    const owner = await track("owner");
    const target = await track("sales");
    const ownerHeaders = await signIn(owner.email, owner.password);
    const targetHeaders = await signIn(target.email, target.password);
    expect(await sessionFor(targetHeaders)).not.toBeNull();

    await getAuth().api.banUser({ body: { userId: target.id }, headers: ownerHeaders });

    expect(await sessionFor(targetHeaders)).toBeNull();
    await expectRejected(
      getAuth().api.signInEmail({ body: { email: target.email, password: target.password } }),
    );
    expect((await auditFor(owner.email, "user.deactivated")).length).toBe(1);
  });

  it("does not allow self-registration or hard deletion over HTTP", async () => {
    const owner = await track("owner");
    const headers = await signIn(owner.email, owner.password);
    const post = (path: string, body: unknown) =>
      getAuth().handler(
        new Request(`${origin}/api/auth${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin,
            cookie: headers.get("cookie") ?? "",
          },
          body: JSON.stringify(body),
        }),
      );

    const signUp = await post("/sign-up/email", {
      email: `new-${crypto.randomUUID()}@example.test`,
      password: "a-very-long-password-123",
      name: "Intruder",
    });
    expect(signUp.status).toBe(404);

    expect((await post("/admin/remove-user", { userId: owner.id })).status).toBe(404);
    expect((await post("/admin/impersonate-user", { userId: owner.id })).status).toBe(404);
    expect(await getDb().user.findUnique({ where: { id: owner.id } })).not.toBeNull();
  });

  // Cross-origin (CSRF) blocking is covered by e2e: Better Auth skips its origin check when
  // NODE_ENV=test, so it can only be verified against a production-mode server.

  it("forces a password change for accounts created by an owner, then clears the flag", async () => {
    const owner = await track("owner");
    const ownerHeaders = await signIn(owner.email, owner.password);
    const { createUser } = await import("@/modules/users/service");
    const ownerSession = await sessionFor(ownerHeaders);

    const email = `invited-${crypto.randomUUID().slice(0, 8)}@example.test`;
    const { user, temporaryPassword } = await createUser(
      { actor: ownerSession?.actor, headers: ownerHeaders },
      { name: "Invited Person", email, role: "technician" },
    );
    created.push({ id: user.id, email, password: temporaryPassword, role: "technician" });
    expect((await auditFor(owner.email, "user.created")).length).toBe(1);

    const headers = await signIn(email, temporaryPassword);
    expect((await sessionFor(headers))?.mustChangePassword).toBe(true);

    const newPassword = "A-brand-new-long-passphrase-7";
    const { headers: changed } = await getAuth().api.changePassword({
      body: { currentPassword: temporaryPassword, newPassword, revokeOtherSessions: true },
      headers,
      returnHeaders: true,
    });
    // The session is replaced on password change: the old cookie stops working, the new works.
    expect(await sessionFor(headers)).toBeNull();
    expect((await sessionFor(cookieHeaders(changed)))?.mustChangePassword).toBe(false);
    expect((await auditFor(email, "auth.password.changed")).length).toBe(1);

    // Old password no longer works; the new one does.
    await expectRejected(
      getAuth().api.signInEmail({ body: { email, password: temporaryPassword } }),
    );
    await signIn(email, newPassword);
  });

  it("rejects weak passwords", async () => {
    const user = await track("viewer");
    const headers = await signIn(user.email, user.password);
    await expectRejected(
      getAuth().api.changePassword({
        body: { currentPassword: user.password, newPassword: "short", revokeOtherSessions: true },
        headers,
      }),
    );
  });

  it("enrols TOTP, then requires a code at sign-in and audits it", async () => {
    const user = await track("owner");
    const headers = await signIn(user.email, user.password);

    const enrol = await getAuth().api.enableTwoFactor({
      body: { password: user.password },
      headers,
    });
    if (!("totpURI" in enrol)) throw new Error("TOTP enrolment expected");
    const secret = new URL(enrol.totpURI).searchParams.get("secret");
    expect(secret).toBeTruthy();
    expect(enrol.backupCodes.length).toBeGreaterThanOrEqual(5);

    await getAuth().api.verifyTOTP({ body: { code: totp(secret!) }, headers });
    const row = await getDb().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.twoFactorEnabled).toBe(true);
    expect((await auditFor(user.email, "auth.2fa.enabled")).length).toBe(1);

    // New sign-in: password alone no longer yields a session.
    const { headers: step1, response } = await getAuth().api.signInEmail({
      body: { email: user.email, password: user.password },
      returnHeaders: true,
    });
    expect("twoFactorRedirect" in response && response.twoFactorRedirect).toBe(true);

    // A wrong code fails (audited); the right one completes the sign-in.
    const pending = new Headers({
      cookie: step1
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    });
    await expectRejected(getAuth().api.verifyTOTP({ body: { code: "000000" }, headers: pending }));
    const { headers: done } = await getAuth().api.verifyTOTP({
      body: { code: totp(secret!, Date.now() + 30_000) },
      headers: pending,
      returnHeaders: true,
    });
    const full = new Headers({
      cookie: done
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    });
    const info = await sessionFor(full);
    expect(info?.twoFactorEnabled).toBe(true);
    expect((await auditFor(user.email, "auth.login.success")).length).toBeGreaterThanOrEqual(2);
  });
});
