import { PgBoss } from "pg-boss";

const globalQueue = globalThis as unknown as {
  aldBoss?: PgBoss;
  aldBossReady?: Promise<PgBoss>;
};

function queueInstance(): PgBoss {
  if (globalQueue.aldBoss) return globalQueue.aldBoss;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL là bắt buộc để gửi background job.");
  globalQueue.aldBoss = new PgBoss({
    connectionString,
    application_name: "ald-web",
    schema: "pgboss",
  });
  globalQueue.aldBoss.on("error", (error) => {
    console.error(JSON.stringify({ event: "job_queue.error", message: error.message }));
  });
  return globalQueue.aldBoss;
}

async function readyQueue(): Promise<PgBoss> {
  if (globalQueue.aldBossReady) return globalQueue.aldBossReady;
  globalQueue.aldBossReady = (async () => {
    const boss = queueInstance();
    await boss.start();
    await boss.createQueue("export-dead-letter");
    await boss.createQueue("payroll-export", { deadLetter: "export-dead-letter" });
    await boss.createQueue("data-export", { deadLetter: "export-dead-letter" });
    await boss.updateQueue("payroll-export", { deadLetter: "export-dead-letter" });
    await boss.updateQueue("data-export", { deadLetter: "export-dead-letter" });
    await boss.createQueue("export-cleanup");
    return boss;
  })();
  return globalQueue.aldBossReady;
}

export async function enqueueDataExport(exportJobId: string): Promise<string> {
  const boss = await readyQueue();
  const jobId = await boss.send(
    "data-export",
    { exportJobId },
    {
      singletonKey: exportJobId,
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
      retryDelayMax: 5 * 60,
      expireInSeconds: 30 * 60,
    },
  );
  if (!jobId) throw new Error("Không thể enqueue data export job.");
  return jobId;
}

export async function enqueuePayrollExport(exportJobId: string): Promise<string> {
  const boss = await readyQueue();
  const jobId = await boss.send(
    "payroll-export",
    { exportJobId },
    {
      singletonKey: exportJobId,
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
      retryDelayMax: 5 * 60,
      expireInSeconds: 30 * 60,
    },
  );
  if (!jobId) throw new Error("Không thể enqueue payroll export job.");
  return jobId;
}

export async function getJobQueueOverview() {
  const boss = await readyQueue();
  const names = ["payroll-export", "data-export", "export-cleanup", "export-dead-letter"];
  return Promise.all(
    names.map(async (name) => {
      const stats = await boss.getQueueStats(name, { force: true });
      const latest = stats.at(-1);
      return {
        name,
        queued: latest?.queuedCount ?? 0,
        active: latest?.activeCount ?? 0,
        failed: latest?.failedCount ?? 0,
        total: latest?.totalCount ?? 0,
        capturedAt: latest?.capturedOn.toISOString() ?? null,
      };
    }),
  );
}
