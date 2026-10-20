import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/server/config/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Returns the ONE shared Prisma client (and therefore one connection pool) for the process.
 *
 * It is cached on `globalThis` in every environment. Caching only outside production would
 * create a new client - and a new pool of up to 10 connections - on every call in production,
 * exhausting PostgreSQL's connections under load (TooManyConnections).
 */
export function getDb(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const { DATABASE_URL } = getEnv();
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not configured");

  globalForPrisma.prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DATABASE_URL }),
  });
  return globalForPrisma.prisma;
}
