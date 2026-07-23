-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('DRAFT', 'PRESENT', 'ABSENT', 'LEAVE');

-- CreateEnum
CREATE TYPE "RevenueUnit" AS ENUM ('VND', 'THOUSAND_VND');

-- AlterTable
ALTER TABLE "companies"
ADD COLUMN "revenueUnit" "RevenueUnit" NOT NULL DEFAULT 'VND',
ADD COLUMN "revenueScale" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "attendance_days" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "businessDate" DATE NOT NULL,
    "checkInAt" TIMESTAMPTZ(3),
    "checkOutAt" TIMESTAMPTZ(3),
    "spansNextDay" BOOLEAN NOT NULL DEFAULT false,
    "workUnits" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMPTZ(3),
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attendance_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_daily_metrics" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "attendanceId" UUID NOT NULL,
    "actualLiveMinutes" INTEGER NOT NULL DEFAULT 0,
    "revenueAmount" BIGINT NOT NULL DEFAULT 0,
    "revenueUnit" "RevenueUnit" NOT NULL,
    "revenueScale" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "live_daily_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_days_company_staff_date_key"
ON "attendance_days"("companyId", "staffId", "businessDate");

-- CreateIndex
CREATE INDEX "attendance_days_company_branch_date_idx"
ON "attendance_days"("companyId", "branchId", "businessDate");

-- CreateIndex
CREATE INDEX "attendance_days_company_staff_date_idx"
ON "attendance_days"("companyId", "staffId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "live_daily_metrics_attendanceId_key"
ON "live_daily_metrics"("attendanceId");

-- CreateIndex
CREATE INDEX "live_daily_metrics_company_branch_idx"
ON "live_daily_metrics"("companyId", "branchId");

-- AddForeignKey
ALTER TABLE "attendance_days"
ADD CONSTRAINT "attendance_days_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_days"
ADD CONSTRAINT "attendance_days_branchId_fkey"
FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_days"
ADD CONSTRAINT "attendance_days_staffId_fkey"
FOREIGN KEY ("staffId") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_days"
ADD CONSTRAINT "attendance_days_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_days"
ADD CONSTRAINT "attendance_days_updatedByUserId_fkey"
FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_daily_metrics"
ADD CONSTRAINT "live_daily_metrics_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_daily_metrics"
ADD CONSTRAINT "live_daily_metrics_branchId_fkey"
FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_daily_metrics"
ADD CONSTRAINT "live_daily_metrics_attendanceId_fkey"
FOREIGN KEY ("attendanceId") REFERENCES "attendance_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Technical bounds are duplicated in application validation and keep invalid
-- imports or future code paths from corrupting attendance history.
ALTER TABLE "companies"
ADD CONSTRAINT "companies_revenue_scale_positive" CHECK ("revenueScale" > 0);

ALTER TABLE "attendance_days"
ADD CONSTRAINT "attendance_days_version_positive" CHECK ("version" > 0),
ADD CONSTRAINT "attendance_days_work_units_bounds" CHECK ("workUnits" >= 0 AND "workUnits" <= 10),
ADD CONSTRAINT "attendance_days_overtime_nonnegative" CHECK ("overtimeMinutes" >= 0),
ADD CONSTRAINT "attendance_days_timestamp_order"
CHECK ("checkOutAt" IS NULL OR ("checkInAt" IS NOT NULL AND "checkOutAt" > "checkInAt"));

ALTER TABLE "live_daily_metrics"
ADD CONSTRAINT "live_daily_metrics_minutes_nonnegative" CHECK ("actualLiveMinutes" >= 0),
ADD CONSTRAINT "live_daily_metrics_revenue_nonnegative" CHECK ("revenueAmount" >= 0),
ADD CONSTRAINT "live_daily_metrics_scale_positive" CHECK ("revenueScale" > 0);
