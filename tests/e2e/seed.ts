/**
 * Seeds throw-away e2e users and writes signed-in browser state files.
 *   tsx tests/e2e/seed.ts setup     -> prints the users as JSON
 *   tsx tests/e2e/seed.ts teardown  -> deletes every user on the e2e domain
 * Runs outside Playwright's loader because the generated Prisma client is ESM.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { E2E_AUTH_SECRET, E2E_EMAIL_DOMAIN, E2E_URL, authFile, type E2ERole } from "./env";

async function main() {
  // Must match the web server's environment so cookies signed here are accepted there.
  process.env.AUTH_SECRET = E2E_AUTH_SECRET;
  process.env.APP_URL = E2E_URL;

  const { getAuth } = await import("@/server/auth");
  const { generateTemporaryPassword } = await import("@/server/auth/policy");
  const { getDb } = await import("@/server/db/client");

  async function createUser(role: E2ERole) {
    const context = await getAuth().$context;
    const password = generateTemporaryPassword();
    const email = `${role}-${crypto.randomUUID().slice(0, 8)}@${E2E_EMAIL_DOMAIN}`;
    const user = await context.internalAdapter.createUser(
      {
        email,
        name: `E2E ${role}`,
        emailVerified: true,
        role: role === "forced" ? "technician" : role,
        mustChangePassword: role === "forced",
      },
      { method: "admin" },
    );
    await context.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: await context.password.hash(password),
    });
    return { email, password };
  }

  async function writeState(role: E2ERole, email: string, password: string) {
    const { headers } = await getAuth().api.signInEmail({
      body: { email, password },
      returnHeaders: true,
    });
    const cookies = headers.getSetCookie().map((line) => {
      const [pair = ""] = line.split(";");
      const index = pair.indexOf("=");
      return {
        name: pair.slice(0, index),
        value: pair.slice(index + 1),
        domain: "localhost",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
      };
    });
    mkdirSync(dirname(authFile(role)), { recursive: true });
    writeFileSync(authFile(role), JSON.stringify({ cookies, origins: [] }));
  }

  try {
    const command = process.argv[2];
    if (command === "setup") {
      const users: Record<string, { email: string; password: string }> = {};
      for (const role of ["owner", "sales", "viewer", "forced"] as const) {
        users[role] = await createUser(role);
      }
      for (const role of ["owner", "sales", "viewer"] as const) {
        await writeState(role, users[role]!.email, users[role]!.password);
      }
      process.stdout.write(`E2E_USERS=${JSON.stringify(users)}\n`);
    } else if (command === "teardown") {
      await getDb().user.deleteMany({ where: { email: { endsWith: `@${E2E_EMAIL_DOMAIN}` } } });
    } else {
      throw new Error("usage: seed.ts setup|teardown");
    }
  } finally {
    await getDb().$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
