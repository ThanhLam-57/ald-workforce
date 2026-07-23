import dotenv from "dotenv";
import { PgBoss } from "pg-boss";
import path from "node:path";

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
await boss.work<{ exportJobId: string }>("payroll-export", async ([job]) => {
  if (!job?.data.exportJobId) {
    throw new Error("Payroll export job thiếu exportJobId.");
  }
  await processPayrollExportJob(job.data.exportJobId);
});
console.info(JSON.stringify({ event: "worker.ready" }));
