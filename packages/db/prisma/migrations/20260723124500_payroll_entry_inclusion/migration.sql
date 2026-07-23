ALTER TABLE "payroll_entries"
ADD COLUMN "included" BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX "payroll_entries_companyId_payrollPeriodId_included_idx"
ON "payroll_entries" ("companyId", "payrollPeriodId", "included");
