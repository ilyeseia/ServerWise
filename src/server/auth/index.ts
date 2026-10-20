import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, twoFactor } from "better-auth/plugins";
import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { clientInfo, recordAuditSafe } from "@/server/audit";
import { logger } from "@/server/logging/logger";
import { ac, authRoles } from "./access-control";
import { MAX_FAILED_LOGINS, LOCKOUT_MINUTES, GENERIC_LOGIN_ERROR } from "./policy";

const DEV_SECRET = "dev-only-secret-never-use-in-production-0123456789";

function emailFromBody(body: unknown): string | null {
  const email = (body as { email?: unknown } | undefined)?.email;
  return typeof email === "string" && email.length > 0 ? email.trim().toLowerCase() : null;
}

function userIdFromBody(body: unknown): string | null {
  const id = (body as { userId?: unknown } | undefined)?.userId;
  return typeof id === "string" ? id : null;
}

/** Reads `{ user: { id } }`-like results without trusting their exact shape. */
function idFromResult(result: unknown): string | null {
  const r = result as { user?: { id?: unknown }; id?: unknown } | null | undefined;
  const id = r?.user?.id ?? r?.id;
  return typeof id === "string" ? id : null;
}

async function recordFailedLogin(email: string, headers: Headers | undefined) {
  const db = getDb();
  const info = clientInfo(headers);
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });

  await recordAuditSafe({
    action: "auth.login.failed",
    actorId: user?.id ?? null,
    actorEmail: email,
    ...info,
  });
  if (!user) return;

  const updated = await db.user.update({
    where: { id: user.id },
    data: { failedLoginCount: { increment: 1 } },
    select: { failedLoginCount: true },
  });
  if (updated.failedLoginCount >= MAX_FAILED_LOGINS) {
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000),
      },
    });
    await recordAuditSafe({
      action: "auth.lockout",
      actorId: user.id,
      actorEmail: email,
      metadata: { minutes: LOCKOUT_MINUTES },
      ...info,
    });
  }
}

async function resetLoginCounters(email: string) {
  await getDb().user.updateMany({
    where: { email },
    data: { failedLoginCount: 0, lockedUntil: null },
  });
}

function createAuth() {
  const env = getEnv();
  const isHttps = env.APP_URL.startsWith("https://");
  const secret = env.AUTH_SECRET ?? (env.NODE_ENV === "production" ? undefined : DEV_SECRET);
  if (!secret) throw new Error("AUTH_SECRET is required in production");

  return betterAuth({
    appName: "ServerWise",
    baseURL: env.APP_URL,
    secret,
    trustedOrigins: [env.APP_URL, ...env.AUTH_TRUSTED_ORIGINS],
    database: prismaAdapter(getDb(), { provider: "postgresql" }),
    telemetry: { enabled: false },
    logger: { level: "warn" },

    emailAndPassword: {
      enabled: true,
      // Invite-only: users are created by an owner, never by self-registration.
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
    },

    user: {
      additionalFields: {
        // Set when an owner creates the account or resets its password; cleared on change.
        mustChangePassword: { type: "boolean", required: false, defaultValue: false, input: false },
      },
    },

    session: {
      expiresIn: 60 * 60 * 12,
      updateAge: 60 * 60,
      cookieCache: { enabled: false },
    },

    advanced: {
      useSecureCookies: isHttps,
      cookiePrefix: "serverwise",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },

    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/two-factor/verify-totp": { window: 60, max: 10 },
        "/two-factor/verify-backup-code": { window: 60, max: 10 },
        "/change-password": { window: 60, max: 5 },
      },
    },

    // Endpoints we never expose: self sign-up, hard delete (would erase accountability) and
    // impersonation (would let an owner act as someone else).
    disabledPaths: [
      "/sign-up/email",
      "/admin/remove-user",
      "/admin/impersonate-user",
      "/admin/stop-impersonating",
    ],

    plugins: [
      admin({
        ac,
        roles: authRoles,
        defaultRole: "viewer",
        adminRoles: ["owner"],
      }),
      twoFactor({ issuer: "ServerWise" }),
      nextCookies(), // must stay last
    ],

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/email") {
          const email = emailFromBody(ctx.body);
          if (!email) return;
          const user = await getDb().user.findUnique({
            where: { email },
            select: { id: true, lockedUntil: true },
          });
          if (user?.lockedUntil && user.lockedUntil > new Date()) {
            await recordAuditSafe({
              action: "auth.login.blocked",
              actorId: user.id,
              actorEmail: email,
              ...clientInfo(ctx.headers),
            });
            // Same answer as a wrong password: do not reveal that the account exists or is locked.
            throw new APIError("UNAUTHORIZED", {
              message: GENERIC_LOGIN_ERROR,
              code: "INVALID_EMAIL_OR_PASSWORD",
            });
          }
        }

        if (ctx.path === "/sign-out") {
          const session = await getSessionFromCtx(ctx).catch(() => null);
          if (session) {
            await recordAuditSafe({
              action: "auth.logout",
              actorId: session.user.id,
              actorEmail: session.user.email,
              ...clientInfo(ctx.headers),
            });
          }
        }
      }),

      after: createAuthMiddleware(async (ctx) => {
        const returned = ctx.context.returned;
        const failed = returned instanceof APIError;
        const info = clientInfo(ctx.headers);

        try {
          switch (ctx.path) {
            case "/sign-in/email": {
              const email = emailFromBody(ctx.body);
              if (!email) return;
              if (failed) {
                await recordFailedLogin(email, ctx.headers);
                return;
              }
              // Correct password: counters reset. A 2FA user is not signed in until the code.
              await resetLoginCounters(email);
              const session = ctx.context.newSession;
              if (session) {
                await recordAuditSafe({
                  action: "auth.login.success",
                  actorId: session.user.id,
                  actorEmail: session.user.email,
                  metadata: { method: "password" },
                  ...info,
                });
              }
              return;
            }

            case "/two-factor/verify-totp":
            case "/two-factor/verify-backup-code": {
              const method = ctx.path.endsWith("totp") ? "totp" : "backup_code";
              const session = ctx.context.newSession;
              // During sign-in the browser carries the short-lived "two_factor" cookie; when an
              // already signed-in user is enrolling, it does not.
              const completingSignIn = /two_factor/.test(ctx.headers?.get("cookie") ?? "");
              if (failed) {
                await recordAuditSafe({ action: "auth.2fa.failed", metadata: { method }, ...info });
              } else if (session && completingSignIn) {
                await recordAuditSafe({
                  action: "auth.login.success",
                  actorId: session.user.id,
                  actorEmail: session.user.email,
                  metadata: { method },
                  ...info,
                });
              } else {
                const current = session ?? (await getSessionFromCtx(ctx).catch(() => null));
                await recordAuditSafe({
                  action: "auth.2fa.enabled",
                  actorId: current?.user.id,
                  actorEmail: current?.user.email,
                  ...info,
                });
              }
              return;
            }

            case "/two-factor/enable":
            case "/two-factor/disable": {
              if (failed) return;
              const current = await getSessionFromCtx(ctx).catch(() => null);
              await recordAuditSafe({
                action: ctx.path.endsWith("enable")
                  ? "auth.2fa.enroll_started"
                  : "auth.2fa.disabled",
                actorId: current?.user.id,
                actorEmail: current?.user.email,
                ...info,
              });
              return;
            }

            case "/change-password": {
              if (failed) return;
              // Changing the password replaces the session (other sessions are revoked), so the
              // old cookie no longer resolves: prefer the freshly issued session.
              const current =
                ctx.context.newSession ?? (await getSessionFromCtx(ctx).catch(() => null));
              if (current) {
                await getDb().user.update({
                  where: { id: current.user.id },
                  data: { mustChangePassword: false },
                });
                await recordAuditSafe({
                  action: "auth.password.changed",
                  actorId: current.user.id,
                  actorEmail: current.user.email,
                  ...info,
                });
              }
              return;
            }

            case "/admin/create-user": {
              if (failed) return;
              const current = await getSessionFromCtx(ctx).catch(() => null);
              const createdId = idFromResult(returned);
              if (createdId) {
                await getDb().user.update({
                  where: { id: createdId },
                  data: { mustChangePassword: true },
                });
              }
              await recordAuditSafe({
                action: "user.created",
                actorId: current?.user.id,
                actorEmail: current?.user.email,
                entityType: "user",
                entityId: createdId,
                metadata: { role: (ctx.body as { role?: string } | undefined)?.role ?? "viewer" },
                ...info,
              });
              return;
            }

            case "/admin/set-user-password": {
              if (failed) return;
              const current = await getSessionFromCtx(ctx).catch(() => null);
              const targetId = userIdFromBody(ctx.body);
              if (targetId) {
                await getDb().user.update({
                  where: { id: targetId },
                  data: { mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
                });
              }
              await recordAuditSafe({
                action: "auth.password.reset_by_admin",
                actorId: current?.user.id,
                actorEmail: current?.user.email,
                entityType: "user",
                entityId: targetId,
                ...info,
              });
              return;
            }

            case "/admin/set-role":
            case "/admin/ban-user":
            case "/admin/unban-user": {
              if (failed) return;
              const current = await getSessionFromCtx(ctx).catch(() => null);
              const action =
                ctx.path === "/admin/set-role"
                  ? "user.role_changed"
                  : ctx.path === "/admin/ban-user"
                    ? "user.deactivated"
                    : "user.reactivated";
              await recordAuditSafe({
                action,
                actorId: current?.user.id,
                actorEmail: current?.user.email,
                entityType: "user",
                entityId: userIdFromBody(ctx.body),
                metadata:
                  ctx.path === "/admin/set-role"
                    ? { role: (ctx.body as { role?: unknown } | undefined)?.role as string }
                    : undefined,
                ...info,
              });
              return;
            }
          }
        } catch (error) {
          // Hooks must never turn a successful auth operation into a failure.
          logger.error({ err: error, path: ctx.path }, "auth after-hook failed");
        }
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/** Lazily created so `next build` does not need runtime secrets. */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}
