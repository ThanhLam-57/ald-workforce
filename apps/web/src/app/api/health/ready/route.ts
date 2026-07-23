import { prisma } from "@ald/db";

import { json } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const [queue] = await prisma.$queryRaw<Array<{ available: boolean }>>`
      SELECT to_regclass('pgboss.queue') IS NOT NULL AS "available"
    `;
    if (!queue?.available) throw new Error("queue_schema_unavailable");
    return json({
      status: "ok",
      service: "web",
      check: "ready",
      dependencies: { database: "ok", workerQueue: "ok" },
      timestamp: new Date().toISOString(),
    });
  } catch {
    return json(
      {
        status: "error",
        service: "web",
        check: "ready",
        dependencies: { database: "unavailable", workerQueue: "unavailable" },
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
