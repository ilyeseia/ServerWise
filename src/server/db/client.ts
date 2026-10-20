import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/server/config/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Returns the shared Prisma client, or throws if DATABASE_URL is not configured. */
export function getDb(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const { DATABASE_URL } = getEnv();
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not configured");

  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  if (getEnv().NODE_ENV !== "production") globalForPrisma.prisma = client;
  return client;
}
