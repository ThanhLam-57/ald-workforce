CREATE TYPE "ImportTemplate" AS ENUM (
  'BRANCHES',
  'STAFF',
  'ASSIGNMENTS',
  'LEVELS',
  'ATTENDANCE_LIVE',
  'REWARD_RULES',
  'PENALTY_RULES',
  'HISTORICAL_PAYROLL'
);

CREATE TYPE "ImportJobStatus" AS ENUM (
  'PENDING_UPLOAD',
  'UPLOADED',
  'VALIDATING',
  'VALIDATED',
  'COMMITTING',
  'SUCCEEDED',
  'FAILED'
);

CREATE TYPE "ImportErrorSeverity" AS ENUM ('WARNING', 'ERROR', 'CRITICAL');
CREATE TYPE "DataExportTemplate" AS ENUM (
  'EMPLOYEE_ERROR_REPORT',
  'BRANCH_MONTHLY',
  'PAYSLIP',
  'COMPANY_MONTHLY',
  'AUDIT'
);
CREATE TYPE "DataExportFormat" AS ENUM ('XLSX', 'CSV');
CREATE TYPE "DataExportStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'EXPIRED');

ALTER TABLE "audit_logs" ADD COLUMN "branchId" UUID;

CREATE TABLE "import_jobs" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "branchId" UUID,
  "template" "ImportTemplate" NOT NULL,
  "status" "ImportJobStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
  "idempotencyKey" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "mapping" JSONB,
  "sourceHeaders" JSONB,
  "previewRows" JSONB,
  "totalRows" INTEGER NOT NULL DEFAULT 0,
  "validRows" INTEGER NOT NULL DEFAULT 0,
  "errorRows" INTEGER NOT NULL DEFAULT 0,
  "committedRows" INTEGER NOT NULL DEFAULT 0,
  "dryRun" BOOLEAN NOT NULL DEFAULT true,
  "errorMessage" TEXT,
  "requestedByUserId" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "uploadedAt" TIMESTAMPTZ(3),
  "validatedAt" TIMESTAMPTZ(3),
  "committedAt" TIMESTAMPTZ(3),
  CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "import_jobs_size_check" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 20971520),
  CONSTRAINT "import_jobs_counts_check" CHECK (
    "totalRows" >= 0 AND "validRows" >= 0 AND "errorRows" >= 0 AND "committedRows" >= 0
  )
);

CREATE TABLE "import_errors" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "importJobId" UUID NOT NULL,
  "sheetName" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "columnName" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "severity" "ImportErrorSeverity" NOT NULL DEFAULT 'ERROR',
  "rawValue" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_errors_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "import_errors_row_check" CHECK ("rowNumber" >= 1)
);

CREATE TABLE "data_export_jobs" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "branchId" UUID,
  "template" "DataExportTemplate" NOT NULL,
  "format" "DataExportFormat" NOT NULL,
  "status" "DataExportStatus" NOT NULL DEFAULT 'QUEUED',
  "parameters" JSONB NOT NULL,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "objectKey" TEXT,
  "fileName" TEXT,
  "mimeType" TEXT,
  "sizeBytes" BIGINT,
  "checksumSha256" TEXT,
  "errorMessage" TEXT,
  "requestedByUserId" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "deletedAt" TIMESTAMPTZ(3),
  CONSTRAINT "data_export_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "data_export_jobs_progress_check" CHECK ("progress" BETWEEN 0 AND 100),
  CONSTRAINT "data_export_jobs_size_check" CHECK ("sizeBytes" IS NULL OR "sizeBytes" >= 0)
);

CREATE UNIQUE INDEX "import_jobs_objectKey_key" ON "import_jobs"("objectKey");
CREATE UNIQUE INDEX "import_jobs_company_idempotency_key" ON "import_jobs"("companyId", "idempotencyKey");
CREATE UNIQUE INDEX "import_jobs_company_template_checksum_key" ON "import_jobs"("companyId", "template", "checksumSha256");
CREATE INDEX "import_jobs_company_status_created_idx" ON "import_jobs"("companyId", "status", "createdAt" DESC);
CREATE INDEX "import_jobs_company_branch_created_idx" ON "import_jobs"("companyId", "branchId", "createdAt" DESC);
CREATE INDEX "import_errors_company_job_row_idx" ON "import_errors"("companyId", "importJobId", "rowNumber");

CREATE UNIQUE INDEX "data_export_jobs_objectKey_key" ON "data_export_jobs"("objectKey");
CREATE INDEX "data_export_jobs_company_status_created_idx" ON "data_export_jobs"("companyId", "status", "createdAt" DESC);
CREATE INDEX "data_export_jobs_company_branch_created_idx" ON "data_export_jobs"("companyId", "branchId", "createdAt" DESC);
CREATE INDEX "data_export_jobs_status_expiry_idx" ON "data_export_jobs"("status", "expiresAt");

CREATE INDEX "audit_logs_company_branch_occurred_idx" ON "audit_logs"("companyId", "branchId", "occurredAt" DESC);
CREATE INDEX "audit_logs_company_actor_occurred_idx" ON "audit_logs"("companyId", "actorUserId", "occurredAt" DESC);
CREATE INDEX "audit_logs_company_action_occurred_idx" ON "audit_logs"("companyId", "action", "occurredAt" DESC);

ALTER TABLE "import_jobs"
  ADD CONSTRAINT "import_jobs_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "import_jobs_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "import_jobs_requestedByUserId_fkey"
  FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "import_errors"
  ADD CONSTRAINT "import_errors_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "import_errors_importJobId_fkey"
  FOREIGN KEY ("importJobId") REFERENCES "import_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "data_export_jobs"
  ADD CONSTRAINT "data_export_jobs_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "data_export_jobs_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "data_export_jobs_requestedByUserId_fkey"
  FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('ald.audit_cleanup', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Audit logs are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_no_update"
BEFORE UPDATE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TRIGGER "audit_logs_no_delete"
BEFORE DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
