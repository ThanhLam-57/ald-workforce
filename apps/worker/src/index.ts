import dotenv from "dotenv";
import { PgBoss } from "pg-boss";
import path from "node:path";

import { cleanupExpiredExports, processDataExportJob } from "./data-export.js";
import { processPayrollExportJob } from "./payroll-export.js";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env"), quiet: true });
dotenv.config({ quiet: true });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL là bắt buộc để khởi động worker.");
}

const boss = new PgBoss({
  connectionString,
  application_name: "ald-worker",
  schema: "pgboss",
});

async function shutdown(signal: string): Promise<void> {
  console.info(JSON.stringify({ event: "worker.shutdown", signal }));
  await boss.stop({ close: true, graceful: true, timeout: 30_000 });
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
await boss.createQueue("payroll-export");
await boss.createQueue("data-export");
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
console.info(JSON.stringify({ event: "worker.ready" }));
