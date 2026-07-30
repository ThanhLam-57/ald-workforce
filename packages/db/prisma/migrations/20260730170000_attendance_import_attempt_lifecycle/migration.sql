ALTER TYPE "ImportJobStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE "ImportJobStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';

ALTER TABLE "import_jobs"
  ADD COLUMN "expiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "supersededAt" TIMESTAMPTZ(3),
  ADD COLUMN "objectDeletedAt" TIMESTAMPTZ(3);

UPDATE "import_jobs"
SET "expiresAt" = CASE
  WHEN "status" = 'PENDING_UPLOAD' THEN "createdAt" + INTERVAL '30 minutes'
  WHEN "status" = 'VALIDATING' THEN COALESCE("validatedAt", "uploadedAt", "createdAt") + INTERVAL '15 minutes'
  WHEN "status" IN ('UPLOADED', 'VALIDATED') THEN COALESCE("validatedAt", "uploadedAt", "createdAt") + INTERVAL '24 hours'
  WHEN "status" = 'COMMITTING' THEN "createdAt" + INTERVAL '24 hours'
  ELSE NULL
END
WHERE "template" = 'ATTENDANCE_MACHINE'
  AND "status" IN ('PENDING_UPLOAD', 'UPLOADED', 'VALIDATING', 'VALIDATED', 'COMMITTING')
  AND "expiresAt" IS NULL;

CREATE INDEX "import_jobs_template_status_expiry_idx"
  ON "import_jobs"("template", "status", "expiresAt");
