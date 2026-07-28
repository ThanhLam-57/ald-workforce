import { prisma } from "@ald/db";

import { json } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return json({
      status: "ok",
      service: "web",
      check: "ready",
      dependencies: { database: "ok" },
      timestamp: new Date().toISOString(),
    });
  } catch {
    return json(
      {
        status: "error",
        service: "web",
        check: "ready",
        dependencies: { database: "unavailable" },
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
