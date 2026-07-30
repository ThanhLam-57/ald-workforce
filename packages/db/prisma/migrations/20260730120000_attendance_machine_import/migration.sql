ALTER TYPE "ImportTemplate" ADD VALUE IF NOT EXISTS 'ATTENDANCE_MACHINE';

ALTER TABLE "import_jobs"
  ADD COLUMN "scopeKey" TEXT NOT NULL DEFAULT 'global',
  ADD COLUMN "targetStaffId" UUID,
  ADD COLUMN "targetMonth" TEXT;

DROP INDEX "import_jobs_company_template_checksum_key";

CREATE UNIQUE INDEX "import_jobs_company_template_checksum_scope_key"
  ON "import_jobs"("companyId", "template", "checksumSha256", "scopeKey");

CREATE INDEX "import_jobs_attendance_machine_target_idx"
  ON "import_jobs"("companyId", "branchId", "targetStaffId", "targetMonth");

ALTER TABLE "import_jobs"
  ADD CONSTRAINT "import_jobs_targetStaffId_fkey"
    FOREIGN KEY ("targetStaffId") REFERENCES "staff_members"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "import_jobs"
  ADD CONSTRAINT "import_jobs_target_month_format_check"
    CHECK ("targetMonth" IS NULL OR "targetMonth" ~ '^(19|20|21)[0-9]{2}-(0[1-9]|1[0-2])$');
