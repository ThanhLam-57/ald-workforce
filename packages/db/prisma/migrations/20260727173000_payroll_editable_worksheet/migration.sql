ALTER TABLE "users"
  ADD COLUMN "canManagePayroll" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "payroll_periods"
  ADD COLUMN "standardDaysOffOverride" INTEGER;

ALTER TABLE "payroll_periods"
  ADD CONSTRAINT "payroll_periods_standard_days_off_check"
  CHECK (
    "standardDaysOffOverride" IS NULL
    OR ("standardDaysOffOverride" >= 0 AND "standardDaysOffOverride" <= 30)
  );

CREATE TABLE "payroll_worksheet_overrides" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "payrollPeriodId" UUID NOT NULL,
  "staffId" UUID NOT NULL,
  "values" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "payroll_worksheet_overrides_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_worksheet_overrides_period_staff_key"
    UNIQUE ("payrollPeriodId", "staffId"),
  CONSTRAINT "payroll_worksheet_overrides_company_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_worksheet_overrides_branch_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_worksheet_overrides_period_fkey"
    FOREIGN KEY ("payrollPeriodId") REFERENCES "payroll_periods"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_worksheet_overrides_staff_fkey"
    FOREIGN KEY ("staffId") REFERENCES "staff_members"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_worksheet_overrides_updated_by_fkey"
    FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE INDEX "payroll_worksheet_overrides_company_branch_period_idx"
  ON "payroll_worksheet_overrides"("companyId", "branchId", "payrollPeriodId");

CREATE INDEX "payroll_worksheet_overrides_company_staff_period_idx"
  ON "payroll_worksheet_overrides"("companyId", "staffId", "payrollPeriodId");

CREATE TRIGGER "payroll_worksheet_overrides_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "payroll_worksheet_overrides"
FOR EACH ROW EXECUTE FUNCTION protect_payroll_child();
