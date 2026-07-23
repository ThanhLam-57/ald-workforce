import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client.js";

const globalForPrisma = globalThis as unknown as {
  aldPrisma?: PrismaClient;
};

function resolveConnectionString(explicit?: string): string {
  const connectionString = explicit ?? process.env.DATABASE_URL;
  if (connectionString) {
    return connectionString;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL là bắt buộc trong production.");
  }
  return "postgresql://ald:ald_local_password@127.0.0.1:55432/ald_workforce";
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
