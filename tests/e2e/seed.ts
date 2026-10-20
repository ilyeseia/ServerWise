/**
 * Seeds throw-away e2e users and CRM fixtures, and writes signed-in browser state files.
 *   tsx tests/e2e/seed.ts setup     -> prints E2E_USERS=... and E2E_FIXTURE=... as JSON
 *   tsx tests/e2e/seed.ts teardown  -> deletes every e2e user and every "ZZ E2E" CRM record
 * Runs outside Playwright's loader because the generated Prisma client is ESM.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  E2E_AUTH_SECRET,
  E2E_DATA_PREFIX,
  E2E_EMAIL_DOMAIN,
  E2E_URL,
  authFile,
  type E2ERole,
} from "./env";

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
    return { id: user.id, email, password };
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

  /** Removes every record the e2e run created (customers cascade to their children). */
  async function deleteCrmData() {
    const db = getDb();
    const where = { name: { startsWith: E2E_DATA_PREFIX } };
    const ids = (await db.customer.findMany({ where, select: { id: true } })).map((c) => c.id);
    if (ids.length === 0) return;
    await db.$transaction(async (tx) => {
      // The communication log is append-only; DDL is transactional, so this is undone on failure.
      await tx.$executeRawUnsafe(
        `ALTER TABLE "communication" DISABLE TRIGGER communication_no_update_delete`,
      );
      await tx.communication.deleteMany({ where: { customerId: { in: ids } } });
      await tx.$executeRawUnsafe(
        `ALTER TABLE "communication" ENABLE TRIGGER communication_no_update_delete`,
      );
      await tx.followUp.deleteMany({ where: { customerId: { in: ids } } });
      await tx.lead.deleteMany({ where: { customerId: { in: ids } } });
      await tx.customer.deleteMany({ where: { id: { in: ids } } });
    });
  }

  try {
    const command = process.argv[2];
    if (command === "setup") {
      await deleteCrmData(); // leftovers of a crashed run
      const users: Record<string, { id: string; email: string; password: string }> = {};
      for (const role of ["owner", "sales", "technician", "viewer", "forced"] as const) {
        users[role] = await createUser(role);
      }
      for (const role of ["owner", "sales", "technician", "viewer"] as const) {
        await writeState(role, users[role]!.email, users[role]!.password);
      }

      const db = getDb();
      const customerName = `${E2E_DATA_PREFIX} Fixture`;
      const customer = await db.customer.create({
        data: {
          type: "business",
          name: customerName,
          legalName: "SARL Fixture",
          phone: "0555 00 11 22",
          email: "fixture@example.test",
          wilayaCode: 19,
          preferredLanguage: "fr",
          createdById: users.owner!.id,
          contacts: {
            create: [{ name: "Contact Fixture", isPrimary: true, phone: "0661 00 11 22" }],
          },
        },
      });
      const lead = await db.lead.create({
        data: {
          customerId: customer.id,
          title: `${E2E_DATA_PREFIX} Fixture lead`,
          source: "referral",
          ownerId: users.sales!.id,
          budgetMinDzd: 100000,
          budgetMaxDzd: 250000,
          createdById: users.owner!.id,
        },
      });
      await db.followUp.create({
        data: {
          customerId: customer.id,
          leadId: lead.id,
          title: `${E2E_DATA_PREFIX} overdue call`,
          dueAt: new Date(Date.now() - 2 * 86_400_000),
          assignedToId: users.sales!.id,
          createdById: users.owner!.id,
        },
      });
      await db.communication.create({
        data: {
          customerId: customer.id,
          leadId: lead.id,
          channel: "call",
          direction: "inbound",
          occurredAt: new Date(Date.now() - 86_400_000),
          summary: "Initial enquiry about a home server",
          createdById: users.sales!.id,
        },
      });

      process.stdout.write(`E2E_USERS=${JSON.stringify(users)}\n`);
      process.stdout.write(
        `E2E_FIXTURE=${JSON.stringify({ customerId: customer.id, customerName, leadId: lead.id, leadTitle: lead.title })}\n`,
      );
    } else if (command === "teardown") {
      await deleteCrmData();
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
