import dotenv from "dotenv";
import { PgBoss } from "pg-boss";
import { prisma, requiredDatabaseUrl } from "@ald/db";
import { createServer } from "node:http";
import path from "node:path";

import { cleanupExpiredExports, processDataExportJob } from "./data-export.js";
import { processPayrollExportJob } from "./payroll-export.js";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env"), quiet: true });
dotenv.config({ quiet: true });

const connectionString = requiredDatabaseUrl();

if (!connectionString) {
  throw new Error("DATABASE_URL là bắt buộc để khởi động worker.");
}

const boss = new PgBoss({
  connectionString,
  application_name: "ald-worker",
  schema: "pgboss",
});
const port = Number(process.env.PORT ?? 3001);
let ready = false;
let shuttingDown = false;

const healthServer = createServer((request, response) => {
  void (async () => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    if (request.url === "/health/live") {
      response.statusCode = 200;
      response.end(JSON.stringify({ status: "ok", service: "worker", check: "live" }));
      return;
    }
    if (request.url === "/health/ready") {
      try {
        if (!ready || shuttingDown) throw new Error("worker_not_ready");
        await prisma.$queryRaw`SELECT 1`;
        await boss.getQueueStats("data-export", { force: true });
        response.statusCode = 200;
        response.end(
          JSON.stringify({
            status: "ok",
            service: "worker",
            check: "ready",
            dependencies: { database: "ok", queue: "ok" },
          }),
        );
      } catch {
        response.statusCode = 503;
        response.end(
          JSON.stringify({
            status: "error",
            service: "worker",
            check: "ready",
            dependencies: { database: "unavailable", queue: "unavailable" },
          }),
        );
      }
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  })();
});

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  ready = false;
  console.info(JSON.stringify({ event: "worker.shutdown", signal }));
  await new Promise<void>((resolve) => {
    healthServer.close(() => resolve());
  });
  await boss.stop({ close: true, graceful: true, timeout: 30_000 });
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

boss.on("error", (error) => {
  console.error(JSON.stringify({ event: "worker.error", message: error.message }));
});

await boss.start();
await boss.createQueue("export-dead-letter");
await boss.createQueue("payroll-export", { deadLetter: "export-dead-letter" });
await boss.createQueue("data-export", { deadLetter: "export-dead-letter" });
await boss.updateQueue("payroll-export", { deadLetter: "export-dead-letter" });
await boss.updateQueue("data-export", { deadLetter: "export-dead-letter" });
await boss.createQueue("export-cleanup");
await boss.schedule("export-cleanup", "0 3 * * *", null, {
  tz: "Asia/Ho_Chi_Minh",
});
await boss.work<{ exportJobId: string }>("payroll-export", async ([job]) => {
  if (!job?.data.exportJobId) {
    throw new Error("Payroll export job thiếu exportJobId.");
  }
  await processPayrollExportJob(job.data.exportJobId);
});
await boss.work<{ exportJobId: string }>("data-export", async ([job]) => {
  if (!job?.data.exportJobId) {
    throw new Error("Data export job thiếu exportJobId.");
  }
  await processDataExportJob(job.data.exportJobId);
});
await boss.work("export-cleanup", async () => {
  const deleted = await cleanupExpiredExports();
  console.info(JSON.stringify({ event: "export.cleanup", deleted }));
});
healthServer.listen(port, "0.0.0.0", () => {
  ready = true;
  console.info(JSON.stringify({ event: "worker.ready", port }));
});
