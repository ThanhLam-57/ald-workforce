import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client.js";
import { requiredDatabaseUrl } from "./database-url.js";

const globalForPrisma = globalThis as unknown as {
  aldPrisma?: PrismaClient;
};

function resolveConnectionString(explicit?: string): string {
  return requiredDatabaseUrl(explicit);
}

export function createPrismaClient(connectionString?: string): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: resolveConnectionString(connectionString),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  });

  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.aldPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.aldPrisma = prisma;
}
