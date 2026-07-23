-- AlterTable
ALTER TABLE "staff_members"
ADD COLUMN "streamingAlias" TEXT;

-- CreateTable
CREATE TABLE "performance_levels" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "performance_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "level_history" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "performanceLevelId" UUID NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "level_history_pkey" PRIMARY KEY ("id")
);

-- Indexes for branch/month projection and filters
CREATE INDEX "staff_members_company_category_status_archived_idx"
ON "staff_members"("companyId", "employmentCategory", "employmentStatus", "archivedAt");

CREATE INDEX "attendance_days_company_branch_date_staff_idx"
ON "attendance_days"("companyId", "branchId", "businessDate", "staffId");

DROP INDEX "live_daily_metrics_company_branch_idx";
CREATE INDEX "live_daily_metrics_company_branch_attendance_idx"
ON "live_daily_metrics"("companyId", "branchId", "attendanceId");

CREATE UNIQUE INDEX "performance_levels_company_code_key"
ON "performance_levels"("companyId", "code");

CREATE INDEX "performance_levels_company_active_order_idx"
ON "performance_levels"("companyId", "isActive", "displayOrder");

CREATE INDEX "level_history_company_staff_interval_idx"
ON "level_history"("companyId", "staffId", "effectiveFrom", "effectiveTo");

CREATE INDEX "level_history_company_level_interval_idx"
ON "level_history"("companyId", "performanceLevelId", "effectiveFrom", "effectiveTo");

-- Foreign keys
ALTER TABLE "performance_levels"
ADD CONSTRAINT "performance_levels_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "level_history"
ADD CONSTRAINT "level_history_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "level_history"
ADD CONSTRAINT "level_history_staffId_fkey"
FOREIGN KEY ("staffId") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "level_history"
ADD CONSTRAINT "level_history_performanceLevelId_fkey"
FOREIGN KEY ("performanceLevelId") REFERENCES "performance_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "level_history"
ADD CONSTRAINT "level_history_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Validity and immutable-history guards
ALTER TABLE "performance_levels"
ADD CONSTRAINT "performance_levels_order_nonnegative"
CHECK ("displayOrder" >= 0);

ALTER TABLE "level_history"
ADD CONSTRAINT "level_history_version_positive"
CHECK ("version" > 0),
ADD CONSTRAINT "level_history_valid_interval"
CHECK ("effectiveTo" IS NULL OR "effectiveFrom" < "effectiveTo");

ALTER TABLE "level_history"
ADD CONSTRAINT "level_history_no_overlap"
EXCLUDE USING gist (
  "companyId" WITH =,
  "staffId" WITH =,
  daterange("effectiveFrom", "effectiveTo", '[)') WITH &&
);

CREATE OR REPLACE FUNCTION prevent_level_history_hard_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Level history cannot be hard deleted; close its interval instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "level_history_no_hard_delete"
BEFORE DELETE ON "level_history"
FOR EACH ROW EXECUTE FUNCTION prevent_level_history_hard_delete();
