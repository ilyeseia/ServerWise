/**
 * Break-glass password reset for an existing account (for example an owner who lost the temporary
 * password printed by owner:create, so nobody can sign in to reset it from the users page):
 *
 *   docker compose run --rm migrate pnpm user:reset-password --email you@example.com
 *
 * A new random temporary password is printed ONCE (never stored in files or logs). The user must
 * change it at the next sign-in; open sessions are revoked and any lockout is cleared. The reset
 * is written to the audit log. Running it needs shell access to the server, which is the point.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { z } from "zod";
import { recordAudit } from "@/server/audit";
import { getAuth } from "@/server/auth";
import { generateTemporaryPassword } from "@/server/auth/policy";
import { getDb } from "@/server/db/client";

const args = z.object({ email: z.email().transform((v) => v.trim().toLowerCase()) });

async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" } } });
  const parsed = args.safeParse(values);
  if (!parsed.success) {
    console.error("Usage: user:reset-password --email <email>");
    process.exitCode = 1;
    return;
  }
  const { email } = parsed.data;

  const db = getDb();
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    console.error("No user with this email exists. Nothing was changed.");
    process.exitCode = 1;
    return;
  }

  const context = await getAuth().$context;
  const password = generateTemporaryPassword();
  const hash = await context.password.hash(password);

  const credential = await db.account.findFirst({
    where: { userId: user.id, providerId: "credential" },
    select: { id: true },
  });
  if (credential) {
    await context.internalAdapter.updatePassword(user.id, hash);
  } else {
    await context.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: hash,
    });
  }
  await db.user.update({
    where: { id: user.id },
    data: { mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
  });
  await db.session.deleteMany({ where: { userId: user.id } });

  await recordAudit({
    action: "auth.password.reset_by_admin",
    actorEmail: "system:reset-password",
    entityType: "user",
    entityId: user.id,
    metadata: { bootstrap: true },
  });

  console.log(`Password reset for: ${email}`);
  console.log(`Temporary password (shown once): ${password}`);
  console.log("Sign in, then change the password immediately.");
}

main()
  .catch((error) => {
    console.error("Reset failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDb().$disconnect();
  });
