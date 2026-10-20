import { z } from "zod";
import { getAuth } from "@/server/auth";
import { generateTemporaryPassword } from "@/server/auth/policy";
import { assertCan, RuleViolationError, type Actor } from "@/server/authz/guard";
import { ROLES, isRole, type Role } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";

/** Who is calling, and the original request headers (Better Auth re-checks the session). */
export interface ServiceContext {
  actor: Actor | null | undefined;
  headers: Headers;
}

export const createUserInput = z.object({
  name: z.string().trim().min(2).max(100),
  // Normalize first, then validate: " Name@Example.COM " is accepted as name@example.com.
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  role: z.enum(ROLES),
});
export type CreateUserInput = z.input<typeof createUserInput>;

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role | null;
  banned: boolean;
  twoFactorEnabled: boolean;
  mustChangePassword: boolean;
  lockedUntil: Date | null;
  createdAt: Date;
}

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  banned: true,
  twoFactorEnabled: true,
  mustChangePassword: true,
  lockedUntil: true,
  createdAt: true,
} as const;

function toRow(u: {
  id: string;
  name: string;
  email: string;
  role: string | null;
  banned: boolean | null;
  twoFactorEnabled: boolean | null;
  mustChangePassword: boolean;
  lockedUntil: Date | null;
  createdAt: Date;
}): UserRow {
  return {
    ...u,
    role: isRole(u.role) ? u.role : null,
    banned: u.banned === true,
    twoFactorEnabled: u.twoFactorEnabled === true,
  };
}

export async function listUsers(ctx: ServiceContext): Promise<UserRow[]> {
  assertCan(ctx.actor, "user:read");
  const users = await getDb().user.findMany({ orderBy: { createdAt: "asc" }, select: userSelect });
  return users.map(toRow);
}

async function activeOwnerCount(excludingUserId?: string): Promise<number> {
  return getDb().user.count({
    where: {
      role: "owner",
      banned: { not: true },
      ...(excludingUserId ? { id: { not: excludingUserId } } : {}),
    },
  });
}

async function requireTarget(userId: string) {
  const target = await getDb().user.findUnique({ where: { id: userId }, select: userSelect });
  if (!target) throw new RuleViolationError("USER_NOT_FOUND", "User not found");
  return target;
}

export async function createUser(
  ctx: ServiceContext,
  input: CreateUserInput,
): Promise<{ user: UserRow; temporaryPassword: string }> {
  assertCan(ctx.actor, "user:manage");
  const data = createUserInput.parse(input);

  const exists = await getDb().user.findUnique({
    where: { email: data.email },
    select: { id: true },
  });
  if (exists) throw new RuleViolationError("EMAIL_TAKEN", "A user with this email already exists");

  const temporaryPassword = generateTemporaryPassword();
  await getAuth().api.createUser({
    body: { email: data.email, password: temporaryPassword, name: data.name, role: data.role },
    headers: ctx.headers,
  });

  const created = await getDb().user.findUniqueOrThrow({
    where: { email: data.email },
    select: userSelect,
  });
  return { user: toRow(created), temporaryPassword };
}

export async function setUserRole(ctx: ServiceContext, userId: string, role: Role): Promise<void> {
  assertCan(ctx.actor, "user:manage");
  if (!isRole(role)) throw new RuleViolationError("INVALID_ROLE", "Unknown role");
  if (userId === ctx.actor.id) {
    throw new RuleViolationError("SELF_CHANGE", "You cannot change your own role");
  }
  const target = await requireTarget(userId);
  if (target.role === "owner" && role !== "owner" && (await activeOwnerCount(userId)) === 0) {
    throw new RuleViolationError("LAST_OWNER", "At least one active owner is required");
  }
  await getAuth().api.setRole({ body: { userId, role }, headers: ctx.headers });
}

export async function setUserActive(
  ctx: ServiceContext,
  userId: string,
  active: boolean,
): Promise<void> {
  assertCan(ctx.actor, "user:manage");
  if (userId === ctx.actor.id) {
    throw new RuleViolationError("SELF_CHANGE", "You cannot deactivate your own account");
  }
  const target = await requireTarget(userId);
  if (!active) {
    if (target.role === "owner" && (await activeOwnerCount(userId)) === 0) {
      throw new RuleViolationError("LAST_OWNER", "At least one active owner is required");
    }
    await getAuth().api.banUser({ body: { userId }, headers: ctx.headers });
  } else {
    await getAuth().api.unbanUser({ body: { userId }, headers: ctx.headers });
  }
}

export async function resetUserPassword(
  ctx: ServiceContext,
  userId: string,
): Promise<{ temporaryPassword: string }> {
  assertCan(ctx.actor, "user:manage");
  await requireTarget(userId);
  const temporaryPassword = generateTemporaryPassword();
  await getAuth().api.setUserPassword({
    body: { userId, newPassword: temporaryPassword },
    headers: ctx.headers,
  });
  return { temporaryPassword };
}
