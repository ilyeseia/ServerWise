/**
 * Break-glass password reset for an existing account (for example an owner who lost the temporary
 * password printed by owner:create, so nobody can sign in to reset it from the users page):
 *
 *   docker compose run --rm migrate pnpm user:reset-password --email you@example.com
 *
 * By default a new random temporary password is printed ONCE (never stored in files or logs) and
 * the user must change it at the next sign-in. With --password-stdin the new password is read from
 * standard input instead (12-128 characters), which avoids copy mistakes and keeps it out of the
 * shell history when read with `read -rs`; it is then not forced to change:
 *
 *   read -rs PW; printf '%s' "$PW" | docker compose run --rm -T migrate \
 *     pnpm user:reset-password --email you@example.com --password-stdin; unset PW
 *
 * Open sessions are revoked and any lockout is cleared. The reset is written to the audit log.
 * Running it needs shell access to the server, which is the point.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { z } from "zod";
import { recordAudit } from "@/server/audit";
import { getAuth } from "@/server/auth";
import { generateTemporaryPassword } from "@/server/auth/policy";
import { getDb } from "@/server/db/client";

const args = z.object({ email: z.email().transform((v) => v.trim().toLowerCase()) });

/** Reads the whole of stdin (a piped password) and drops the trailing line break. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/^﻿/, "") // a byte-order mark added by some Windows shells
    .replace(/\r?\n$/, "");
}

async function readChosenPassword(): Promise<string | null> {
  if (process.stdin.isTTY) {
    console.error("--password-stdin expects the password on standard input (see the usage notes).");
    return null;
  }
  const password = await readStdin();
  if (password.length < 12 || password.length > 128) {
    console.error("The password must be 12 to 128 characters. Nothing was changed.");
    return null;
  }
  return password;
}

async function main() {
  const { values } = parseArgs({
    options: { email: { type: "string" }, "password-stdin": { type: "boolean", default: false } },
  });
  const parsed = args.safeParse(values);
  if (!parsed.success) {
    console.error("Usage: user:reset-password --email <email> [--password-stdin]");
    process.exitCode = 1;
    return;
  }
  const { email } = parsed.data;
  const chosen = values["password-stdin"] === true;

  const db = getDb();
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    console.error("No user with this email exists. Nothing was changed.");
    process.exitCode = 1;
    return;
  }

  let password: string;
  if (chosen) {
    const typed = await readChosenPassword();
    if (typed === null) {
      process.exitCode = 1;
      return;
    }
    password = typed;
  } else {
    password = generateTemporaryPassword();
  }
  const context = await getAuth().$context;
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
    data: { mustChangePassword: !chosen, failedLoginCount: 0, lockedUntil: null },
  });
  await db.session.deleteMany({ where: { userId: user.id } });

  await recordAudit({
    action: "auth.password.reset_by_admin",
    actorEmail: "system:reset-password",
    entityType: "user",
    entityId: user.id,
    metadata: { bootstrap: true, chosen },
  });

  console.log(`Password reset for: ${email}`);
  if (chosen) {
    console.log("The password you typed is now active. Sign in with it.");
  } else {
    console.log(`Temporary password (shown once): ${password}`);
    console.log("Sign in, then change the password immediately.");
  }
}

main()
  .catch((error) => {
    console.error("Reset failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDb().$disconnect();
  });
