/**
 * Creates an owner account. Run once to bootstrap a new installation:
 *
 *   pnpm owner:create --email you@example.com --name "Your Name"
 *   docker compose run --rm migrate pnpm owner:create --email you@example.com --name "Your Name"
 *
 * A random temporary password is printed ONCE (never stored in files or logs). The owner must
 * change it at first sign-in, and enrol two-factor authentication when the policy requires it.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { z } from "zod";
import { recordAudit } from "@/server/audit";
import { getAuth } from "@/server/auth";
import { generateTemporaryPassword } from "@/server/auth/policy";
import { getDb } from "@/server/db/client";

const args = z.object({
  email: z.email().transform((v) => v.trim().toLowerCase()),
  name: z.string().trim().min(2).max(100),
});

async function main() {
  const { values } = parseArgs({
    options: { email: { type: "string" }, name: { type: "string" } },
  });
  const parsed = args.safeParse(values);
  if (!parsed.success) {
    console.error('Usage: owner:create --email <email> --name "<full name>"');
    process.exitCode = 1;
    return;
  }
  const { email, name } = parsed.data;

  const db = getDb();
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
    console.error("A user with this email already exists. Nothing was changed.");
    process.exitCode = 1;
    return;
  }

  const context = await getAuth().$context;
  const password = generateTemporaryPassword();
  const hash = await context.password.hash(password);

  const user = await context.internalAdapter.createUser(
    { email, name, emailVerified: true, role: "owner", mustChangePassword: true },
    { method: "admin" },
  );
  await context.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: hash,
  });

  await recordAudit({
    action: "user.created",
    actorEmail: "system:create-owner",
    entityType: "user",
    entityId: user.id,
    metadata: { role: "owner", bootstrap: true },
  });

  console.log(`Owner created: ${email}`);
  console.log(`Temporary password (shown once): ${password}`);
  console.log("Sign in, then change the password immediately.");
}

main()
  .catch((error) => {
    console.error("Failed to create the owner:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDb().$disconnect();
  });
