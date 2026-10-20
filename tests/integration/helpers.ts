import { createHmac } from "node:crypto";
import { getAuth } from "@/server/auth";
import { generateTemporaryPassword } from "@/server/auth/policy";
import { getSessionInfo } from "@/server/auth/session";
import type { Role } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";

export const TEST_DOMAIN = "example.test";

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: Role;
}

/** Creates a user directly (bypassing the invite-only API), like the bootstrap script does. */
export async function createTestUser(
  role: Role,
  options: { mustChangePassword?: boolean; password?: string } = {},
): Promise<TestUser> {
  const context = await getAuth().$context;
  const password = options.password ?? generateTemporaryPassword();
  const email = `${role}-${crypto.randomUUID().slice(0, 8)}@${TEST_DOMAIN}`;

  const user = await context.internalAdapter.createUser(
    {
      email,
      name: `Test ${role}`,
      emailVerified: true,
      role,
      mustChangePassword: options.mustChangePassword ?? false,
    },
    { method: "admin" },
  );
  await context.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await context.password.hash(password),
  });
  return { id: user.id, email, password, role };
}

export async function deleteTestUsers(users: Pick<TestUser, "id">[]) {
  if (users.length === 0) return;
  await getDb().user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
}

/** Signs in through the real API and returns request headers carrying the session cookie. */
export async function signIn(email: string, password: string): Promise<Headers> {
  const { headers, response } = await getAuth().api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  if ("twoFactorRedirect" in response) throw new Error("two-factor required");
  return cookieHeaders(headers);
}

export function cookieHeaders(responseHeaders: Headers): Headers {
  const cookie = responseHeaders
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return new Headers({ cookie });
}

export async function sessionFor(headers: Headers) {
  return getSessionInfo(headers);
}

/** Audit rows for an actor email (the log is append-only, so tests identify rows by email). */
export async function auditFor(email: string, action?: string) {
  return getDb().auditLog.findMany({
    where: { actorEmail: email, ...(action ? { action } : {}) },
    orderBy: { createdAt: "asc" },
  });
}

// --- Minimal RFC 6238 TOTP (SHA-1, 6 digits, 30 s) so tests can complete 2FA enrolment. ---

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of input.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totp(secretBase32: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const hmac = createHmac("sha1", base32Decode(secretBase32)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] as number) & 0x0f;
  const code =
    (((hmac[offset] as number) & 0x7f) << 24) |
    (((hmac[offset + 1] as number) & 0xff) << 16) |
    (((hmac[offset + 2] as number) & 0xff) << 8) |
    ((hmac[offset + 3] as number) & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}
