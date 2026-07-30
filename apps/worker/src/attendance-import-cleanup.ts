import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "@ald/db";

const ATTENDANCE_IMPORT_TEMPLATE = "ATTENDANCE_MACHINE" as const;
const EXPIRABLE_STATUSES = [
  "PENDING_UPLOAD",
  "UPLOADED",
  "VALIDATING",
  "VALIDATED",
  "COMMITTING",
] as const;
const CLEANUP_STATUSES = ["SUCCEEDED", "FAILED", "EXPIRED", "SUPERSEDED"] as const;
const DEFAULT_RETENTION_DAYS = 30;
const MAX_BATCH_SIZE = 500;

type CleanupStatus = (typeof CLEANUP_STATUSES)[number];

type RetentionTimestamps = Readonly<{
  createdAt: Date;
  uploadedAt: Date | null;
  validatedAt: Date | null;
  committedAt: Date | null;
  expiresAt: Date | null;
}>;

export type AttendanceImportCleanupResult = Readonly<{
  expired: number;
  objectsDeleted: number;
  errors: number;
}>;

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message.slice(0, 500) : "Unknown cleanup error";
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Thiếu biến môi trường ${name}.`);
  return value;
}

function storageClient(): { bucket: string; client: S3Client } {
  return {
    bucket: requiredEnvironment("S3_BUCKET"),
    client: new S3Client({
      endpoint: requiredEnvironment("S3_ENDPOINT"),
      region: process.env.S3_REGION ?? "us-east-1",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: {
        accessKeyId: requiredEnvironment("S3_ACCESS_KEY"),
        secretAccessKey: requiredEnvironment("S3_SECRET_KEY"),
      },
    }),
  };
}

export function attendanceImportRetentionDays(
  raw = process.env.ATTENDANCE_IMPORT_RETENTION_DAYS,
): number {
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 365 ? parsed : DEFAULT_RETENTION_DAYS;
}

export function attendanceImportRetentionReference(timestamps: RetentionTimestamps): Date {
  const values = [
    timestamps.createdAt,
    timestamps.uploadedAt,
    timestamps.validatedAt,
    timestamps.committedAt,
    timestamps.expiresAt,
  ].filter((value): value is Date => value instanceof Date);
  return new Date(Math.max(...values.map((value) => value.getTime())));
}

async function expireStaleAttempts(now: Date): Promise<{ expired: number; errors: number }> {
  const candidates = await prisma.importJob.findMany({
    where: {
      template: ATTENDANCE_IMPORT_TEMPLATE,
      status: { in: [...EXPIRABLE_STATUSES] },
      expiresAt: { lte: now },
    },
    select: {
      id: true,
      companyId: true,
      branchId: true,
      status: true,
      expiresAt: true,
    },
    orderBy: { expiresAt: "asc" },
    take: MAX_BATCH_SIZE,
  });

  let expired = 0;
  let errors = 0;
  for (const job of candidates) {
    try {
      const transitioned = await prisma.$transaction(async (tx) => {
        const update = await tx.importJob.updateMany({
          where: {
            id: job.id,
            companyId: job.companyId,
            template: ATTENDANCE_IMPORT_TEMPLATE,
            status: job.status,
            expiresAt: { lte: now },
          },
          data: { status: "EXPIRED" },
        });
        if (update.count !== 1) return false;
        await tx.auditLog.create({
          data: {
            companyId: job.companyId,
            branchId: job.branchId,
            actorUserId: null,
            action: "ATTENDANCE_MACHINE_IMPORT_EXPIRED",
            entityType: "ImportJob",
            entityId: job.id,
            reason: "System cleanup: import attempt exceeded its allowed lifetime.",
            before: {
              status: job.status,
              expiresAt: job.expiresAt?.toISOString() ?? null,
            },
            after: {
              status: "EXPIRED",
              expiredAt: now.toISOString(),
            },
          },
        });
        return true;
      });
      if (transitioned) expired += 1;
    } catch (cause) {
      errors += 1;
      console.error(
        JSON.stringify({
          event: "attendance_import.cleanup.expire_failed",
          importJobId: job.id,
          message: errorMessage(cause),
        }),
      );
    }
  }
  return { expired, errors };
}

async function deleteRetainedObjects(
  now: Date,
): Promise<{ objectsDeleted: number; errors: number }> {
  const retentionCutoff = new Date(
    now.getTime() - attendanceImportRetentionDays() * 24 * 60 * 60 * 1_000,
  );
  const candidates = await prisma.importJob.findMany({
    where: {
      template: ATTENDANCE_IMPORT_TEMPLATE,
      status: { in: [...CLEANUP_STATUSES] },
      objectDeletedAt: null,
      createdAt: { lte: retentionCutoff },
    },
    select: {
      id: true,
      companyId: true,
      branchId: true,
      status: true,
      objectKey: true,
      createdAt: true,
      uploadedAt: true,
      validatedAt: true,
      committedAt: true,
      expiresAt: true,
    },
    orderBy: { createdAt: "asc" },
    take: MAX_BATCH_SIZE,
  });
  const eligible = candidates.filter(
    (job) => attendanceImportRetentionReference(job).getTime() <= retentionCutoff.getTime(),
  );
  if (eligible.length === 0) return { objectsDeleted: 0, errors: 0 };

  let storage: ReturnType<typeof storageClient>;
  try {
    storage = storageClient();
  } catch (cause) {
    console.error(
      JSON.stringify({
        event: "attendance_import.cleanup.storage_unavailable",
        message: errorMessage(cause),
      }),
    );
    return { objectsDeleted: 0, errors: eligible.length };
  }

  let objectsDeleted = 0;
  let errors = 0;
  for (const job of eligible) {
    try {
      await storage.client.send(
        new DeleteObjectCommand({
          Bucket: storage.bucket,
          Key: job.objectKey,
        }),
      );
      const recorded = await prisma.$transaction(async (tx) => {
        const update = await tx.importJob.updateMany({
          where: {
            id: job.id,
            companyId: job.companyId,
            template: ATTENDANCE_IMPORT_TEMPLATE,
            status: job.status as CleanupStatus,
            objectDeletedAt: null,
          },
          data: { objectDeletedAt: now },
        });
        if (update.count !== 1) return false;
        await tx.auditLog.create({
          data: {
            companyId: job.companyId,
            branchId: job.branchId,
            actorUserId: null,
            action: "ATTENDANCE_MACHINE_IMPORT_OBJECT_DELETED",
            entityType: "ImportJob",
            entityId: job.id,
            reason: "System cleanup: private source file exceeded retention.",
            before: {
              status: job.status,
              objectDeletedAt: null,
            },
            after: {
              status: job.status,
              objectDeletedAt: now.toISOString(),
            },
          },
        });
        return true;
      });
      if (recorded) objectsDeleted += 1;
    } catch (cause) {
      errors += 1;
      console.error(
        JSON.stringify({
          event: "attendance_import.cleanup.object_delete_failed",
          importJobId: job.id,
          message: errorMessage(cause),
        }),
      );
    }
  }
  storage.client.destroy();
  return { objectsDeleted, errors };
}

export async function cleanupAttendanceMachineImports(
  now = new Date(),
): Promise<AttendanceImportCleanupResult> {
  const expiry = await expireStaleAttempts(now);
  const objectCleanup = await deleteRetainedObjects(now);
  return {
    expired: expiry.expired,
    objectsDeleted: objectCleanup.objectsDeleted,
    errors: expiry.errors + objectCleanup.errors,
  };
}
