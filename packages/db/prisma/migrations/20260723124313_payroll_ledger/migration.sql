-- CreateEnum
CREATE TYPE "PayrollPeriodStatus" AS ENUM ('DRAFT', 'CALCULATED', 'REVIEWED', 'LOCKED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "PayrollLineType" AS ENUM ('BASE_SALARY', 'PRORATED_SALARY', 'DAILY_REVENUE_BONUS', 'MONTHLY_REVENUE_BONUS', 'ATTENDANCE_BONUS', 'ACHIEVEMENT_BONUS', 'LEVEL_BONUS', 'OVERTIME_PAY', 'OTHER_BONUS', 'PENALTY', 'ADVANCE', 'TOTAL_INCOME');

-- CreateEnum
CREATE TYPE "PayrollAdjustmentType" AS ENUM ('OTHER_BONUS', 'ADVANCE', 'CORRECTION');

-- CreateEnum
CREATE TYPE "PayrollExportKind" AS ENUM ('PAYSLIP_XLSX', 'PAYSLIP_PDF', 'BULK_ZIP');

-- CreateEnum
CREATE TYPE "PayrollExportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "payroll_periods" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "month" DATE NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "PayrollPeriodStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourcePeriodId" UUID,
    "latestCalculationNo" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" UUID NOT NULL,
    "creationReason" TEXT NOT NULL,
    "calculatedAt" TIMESTAMPTZ(3),
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewReason" TEXT,
    "lockedByUserId" UUID,
    "lockedAt" TIMESTAMPTZ(3),
    "lockReason" TEXT,
    "publishedByUserId" UUID,
    "publishedAt" TIMESTAMPTZ(3),
    "publishReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payroll_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_entries" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "payrollPeriodId" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "currentSnapshotId" UUID,
    "workUnits" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "revenueAmount" BIGINT NOT NULL DEFAULT 0,
    "actualLiveMinutes" INTEGER NOT NULL DEFAULT 0,
    "baseSalary" BIGINT NOT NULL DEFAULT 0,
    "proratedSalary" BIGINT NOT NULL DEFAULT 0,
    "dailyRevenueBonus" BIGINT NOT NULL DEFAULT 0,
    "monthlyRevenueBonus" BIGINT NOT NULL DEFAULT 0,
    "attendanceBonus" BIGINT NOT NULL DEFAULT 0,
    "achievementBonus" BIGINT NOT NULL DEFAULT 0,
    "levelBonus" BIGINT NOT NULL DEFAULT 0,
    "overtimePay" BIGINT NOT NULL DEFAULT 0,
    "otherBonus" BIGINT NOT NULL DEFAULT 0,
    "penalties" BIGINT NOT NULL DEFAULT 0,
    "advance" BIGINT NOT NULL DEFAULT 0,
    "totalIncome" BIGINT NOT NULL DEFAULT 0,
    "anomalyFlags" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payroll_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calculation_snapshots" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "payrollPeriodId" UUID NOT NULL,
    "payrollEntryId" UUID NOT NULL,
    "calculationNo" INTEGER NOT NULL,
    "inputHash" TEXT NOT NULL,
    "outputHash" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "selectedRuleVersions" JSONB NOT NULL,
    "roundingPolicy" JSONB NOT NULL,
    "outputs" JSONB NOT NULL,
    "calculatedByUserId" UUID NOT NULL,
    "calculatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calculation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_lines" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "payrollEntryId" UUID NOT NULL,
    "calculationSnapshotId" UUID NOT NULL,
    "type" "PayrollLineType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ruleVersionId" UUID,
    "label" TEXT NOT NULL,
    "calculationDetails" JSONB NOT NULL,
    "includedInTotal" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_adjustments" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "payrollPeriodId" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "type" "PayrollAdjustmentType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceDocument" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" UUID NOT NULL,
    "approvedByUserId" UUID NOT NULL,
    "approvedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payroll_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_export_jobs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "payrollPeriodId" UUID NOT NULL,
    "staffId" UUID,
    "kind" "PayrollExportKind" NOT NULL,
    "status" "PayrollExportStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "objectKey" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" BIGINT,
    "checksumSha256" TEXT,
    "templateVersion" TEXT NOT NULL DEFAULT 'PAYSLIP_V1',
    "errorMessage" TEXT,
    "requestedByUserId" UUID NOT NULL,
    "requestReason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "payroll_export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_download_logs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "payrollPeriodId" UUID NOT NULL,
    "exportJobId" UUID NOT NULL,
    "staffId" UUID,
    "downloadedByUserId" UUID NOT NULL,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "downloadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_download_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_periods_companyId_branchId_month_status_idx" ON "payroll_periods"("companyId", "branchId", "month", "status");

-- CreateIndex
CREATE INDEX "payroll_periods_companyId_month_status_idx" ON "payroll_periods"("companyId", "month", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_periods_companyId_branchId_month_revision_key" ON "payroll_periods"("companyId", "branchId", "month", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_entries_currentSnapshotId_key" ON "payroll_entries"("currentSnapshotId");

-- CreateIndex
CREATE INDEX "payroll_entries_companyId_branchId_payrollPeriodId_idx" ON "payroll_entries"("companyId", "branchId", "payrollPeriodId");

-- CreateIndex
CREATE INDEX "payroll_entries_companyId_staffId_payrollPeriodId_idx" ON "payroll_entries"("companyId", "staffId", "payrollPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_entries_payrollPeriodId_staffId_key" ON "payroll_entries"("payrollPeriodId", "staffId");

-- CreateIndex
CREATE INDEX "calculation_snapshots_companyId_payrollPeriodId_calculation_idx" ON "calculation_snapshots"("companyId", "payrollPeriodId", "calculationNo");

-- CreateIndex
CREATE INDEX "calculation_snapshots_companyId_inputHash_idx" ON "calculation_snapshots"("companyId", "inputHash");

-- CreateIndex
CREATE UNIQUE INDEX "calculation_snapshots_payrollEntryId_calculationNo_key" ON "calculation_snapshots"("payrollEntryId", "calculationNo");

-- CreateIndex
CREATE INDEX "payroll_lines_companyId_payrollEntryId_calculationSnapshotI_idx" ON "payroll_lines"("companyId", "payrollEntryId", "calculationSnapshotId", "displayOrder");

-- CreateIndex
CREATE INDEX "payroll_lines_companyId_sourceType_sourceId_idx" ON "payroll_lines"("companyId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "payroll_adjustments_companyId_payrollPeriodId_staffId_idx" ON "payroll_adjustments"("companyId", "payrollPeriodId", "staffId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_export_jobs_objectKey_key" ON "payroll_export_jobs"("objectKey");

-- CreateIndex
CREATE INDEX "payroll_export_jobs_companyId_payrollPeriodId_createdAt_idx" ON "payroll_export_jobs"("companyId", "payrollPeriodId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "payroll_export_jobs_companyId_requestedByUserId_status_idx" ON "payroll_export_jobs"("companyId", "requestedByUserId", "status");

-- CreateIndex
CREATE INDEX "payroll_download_logs_companyId_payrollPeriodId_downloadedA_idx" ON "payroll_download_logs"("companyId", "payrollPeriodId", "downloadedAt" DESC);

-- CreateIndex
CREATE INDEX "payroll_download_logs_companyId_downloadedByUserId_download_idx" ON "payroll_download_logs"("companyId", "downloadedByUserId", "downloadedAt" DESC);

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_sourcePeriodId_fkey" FOREIGN KEY ("sourcePeriodId") REFERENCES "payroll_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_lockedByUserId_fkey" FOREIGN KEY ("lockedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_payrollPeriodId_fkey" FOREIGN KEY ("payrollPeriodId") REFERENCES "payroll_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_currentSnapshotId_fkey" FOREIGN KEY ("currentSnapshotId") REFERENCES "calculation_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_snapshots" ADD CONSTRAINT "calculation_snapshots_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_snapshots" ADD CONSTRAINT "calculation_snapshots_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_snapshots" ADD CONSTRAINT "calculation_snapshots_payrollPeriodId_fkey" FOREIGN KEY ("payrollPeriodId") REFERENCES "payroll_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_snapshots" ADD CONSTRAINT "calculation_snapshots_payrollEntryId_fkey" FOREIGN KEY ("payrollEntryId") REFERENCES "payroll_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_snapshots" ADD CONSTRAINT "calculation_snapshots_calculatedByUserId_fkey" FOREIGN KEY ("calculatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_payrollEntryId_fkey" FOREIGN KEY ("payrollEntryId") REFERENCES "payroll_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_calculationSnapshotId_fkey" FOREIGN KEY ("calculationSnapshotId") REFERENCES "calculation_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_payrollPeriodId_fkey" FOREIGN KEY ("payrollPeriodId") REFERENCES "payroll_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_export_jobs" ADD CONSTRAINT "payroll_export_jobs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_export_jobs" ADD CONSTRAINT "payroll_export_jobs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_export_jobs" ADD CONSTRAINT "payroll_export_jobs_payrollPeriodId_fkey" FOREIGN KEY ("payrollPeriodId") REFERENCES "payroll_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_export_jobs" ADD CONSTRAINT "payroll_export_jobs_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_export_jobs" ADD CONSTRAINT "payroll_export_jobs_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_download_logs" ADD CONSTRAINT "payroll_download_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_download_logs" ADD CONSTRAINT "payroll_download_logs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_download_logs" ADD CONSTRAINT "payroll_download_logs_payrollPeriodId_fkey" FOREIGN KEY ("payrollPeriodId") REFERENCES "payroll_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_download_logs" ADD CONSTRAINT "payroll_download_logs_exportJobId_fkey" FOREIGN KEY ("exportJobId") REFERENCES "payroll_export_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_download_logs" ADD CONSTRAINT "payroll_download_logs_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_download_logs" ADD CONSTRAINT "payroll_download_logs_downloadedByUserId_fkey" FOREIGN KEY ("downloadedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
