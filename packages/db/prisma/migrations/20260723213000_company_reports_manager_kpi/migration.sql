CREATE TYPE "ManagerKpiEvaluationStatus" AS ENUM ('DRAFT', 'PUBLISHED');

ALTER TABLE "companies"
ADD COLUMN "managerKpiSelfServiceEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "staff_employment_history" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "staffId" UUID NOT NULL,
  "employmentStatus" "EmploymentStatus" NOT NULL,
  "employmentCategory" "EmploymentCategory" NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "staff_employment_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_employment_history_companyId_staffId_effectiveFrom_key"
ON "staff_employment_history"("companyId", "staffId", "effectiveFrom");

CREATE INDEX "staff_employment_history_companyId_staffId_effectiveFrom_effectiveTo_idx"
ON "staff_employment_history"("companyId", "staffId", "effectiveFrom", "effectiveTo");

CREATE INDEX "staff_employment_history_companyId_status_category_effective_idx"
ON "staff_employment_history"("companyId", "employmentStatus", "employmentCategory", "effectiveFrom");

ALTER TABLE "staff_employment_history"
ADD CONSTRAINT "staff_employment_history_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "staff_employment_history_staffId_fkey"
FOREIGN KEY ("staffId") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "staff_employment_history_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "staff_employment_history_interval_check"
CHECK ("effectiveTo" IS NULL OR "effectiveFrom" < "effectiveTo"),
ADD CONSTRAINT "staff_employment_history_version_check"
CHECK ("version" > 0),
ADD CONSTRAINT "staff_employment_history_no_overlap"
EXCLUDE USING gist (
  "companyId" WITH =,
  "staffId" WITH =,
  daterange("effectiveFrom", "effectiveTo", '[)') WITH &&
);

INSERT INTO "staff_employment_history" (
  "id", "companyId", "staffId", "employmentStatus", "employmentCategory",
  "effectiveFrom", "effectiveTo", "version", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), "companyId", "id", "employmentStatus", "employmentCategory",
  "createdAt"::date, NULL, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "staff_members";

CREATE TABLE "manager_kpi_evaluations" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "managerStaffId" UUID NOT NULL,
  "month" DATE NOT NULL,
  "templateRuleVersionId" UUID NOT NULL,
  "status" "ManagerKpiEvaluationStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "totalScore" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "maximumScore" DECIMAL(10,2) NOT NULL,
  "notes" TEXT,
  "createdByUserId" UUID NOT NULL,
  "publishedByUserId" UUID,
  "publishedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "manager_kpi_evaluations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "manager_kpi_evaluations_companyId_managerStaffId_month_key"
ON "manager_kpi_evaluations"("companyId", "managerStaffId", "month");

CREATE INDEX "manager_kpi_evaluations_companyId_month_status_idx"
ON "manager_kpi_evaluations"("companyId", "month", "status");

CREATE INDEX "manager_kpi_evaluations_companyId_branchId_month_idx"
ON "manager_kpi_evaluations"("companyId", "branchId", "month");

ALTER TABLE "manager_kpi_evaluations"
ADD CONSTRAINT "manager_kpi_evaluations_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "manager_kpi_evaluations_branchId_fkey"
FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "manager_kpi_evaluations_managerStaffId_fkey"
FOREIGN KEY ("managerStaffId") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "manager_kpi_evaluations_templateRuleVersionId_fkey"
FOREIGN KEY ("templateRuleVersionId") REFERENCES "rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "manager_kpi_evaluations_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "manager_kpi_evaluations_publishedByUserId_fkey"
FOREIGN KEY ("publishedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "manager_kpi_evaluations_month_alignment"
CHECK ("month" = date_trunc('month', "month")::date),
ADD CONSTRAINT "manager_kpi_evaluations_score_check"
CHECK ("totalScore" >= 0 AND "maximumScore" > 0),
ADD CONSTRAINT "manager_kpi_evaluations_publish_fields"
CHECK (
  ("status" = 'DRAFT' AND "publishedByUserId" IS NULL AND "publishedAt" IS NULL)
  OR
  ("status" = 'PUBLISHED' AND "publishedByUserId" IS NOT NULL AND "publishedAt" IS NOT NULL)
);

CREATE TABLE "manager_kpi_criterion_lines" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "evaluationId" UUID NOT NULL,
  "criterionCode" TEXT NOT NULL,
  "criterionName" TEXT NOT NULL,
  "criterionDescription" TEXT NOT NULL,
  "weightBps" INTEGER NOT NULL,
  "maxScore" INTEGER NOT NULL,
  "requiredEvidence" BOOLEAN NOT NULL,
  "requiredNote" BOOLEAN NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "score" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "weightedScore" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "note" TEXT,
  "evidence" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "manager_kpi_criterion_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "manager_kpi_criterion_lines_evaluationId_criterionCode_key"
ON "manager_kpi_criterion_lines"("evaluationId", "criterionCode");

CREATE INDEX "manager_kpi_criterion_lines_companyId_evaluationId_displayOrder_idx"
ON "manager_kpi_criterion_lines"("companyId", "evaluationId", "displayOrder");

ALTER TABLE "manager_kpi_criterion_lines"
ADD CONSTRAINT "manager_kpi_criterion_lines_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "manager_kpi_criterion_lines_evaluationId_fkey"
FOREIGN KEY ("evaluationId") REFERENCES "manager_kpi_evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "manager_kpi_criterion_lines_score_check"
CHECK (
  "weightBps" > 0 AND "weightBps" <= 10000
  AND "maxScore" > 0
  AND "score" >= 0 AND "score" <= "maxScore"
  AND "weightedScore" >= 0
);

CREATE OR REPLACE FUNCTION protect_staff_employment_history()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Staff employment history cannot be hard-deleted';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "staff_employment_history_no_delete"
BEFORE DELETE ON "staff_employment_history"
FOR EACH ROW EXECUTE FUNCTION protect_staff_employment_history();

CREATE OR REPLACE FUNCTION protect_manager_kpi_evaluation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Manager KPI evaluations cannot be hard-deleted';
  END IF;
  IF OLD.status = 'PUBLISHED' THEN
    RAISE EXCEPTION 'Published manager KPI evaluations are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "manager_kpi_evaluations_guard"
BEFORE UPDATE OR DELETE ON "manager_kpi_evaluations"
FOR EACH ROW EXECUTE FUNCTION protect_manager_kpi_evaluation();

CREATE OR REPLACE FUNCTION protect_manager_kpi_line()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Manager KPI criterion lines cannot be hard-deleted';
  END IF;
  PERFORM 1
  FROM "manager_kpi_evaluations"
  WHERE id = COALESCE(NEW."evaluationId", OLD."evaluationId")
    AND status = 'DRAFT';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Published manager KPI criterion lines are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "manager_kpi_criterion_lines_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "manager_kpi_criterion_lines"
FOR EACH ROW EXECUTE FUNCTION protect_manager_kpi_line();
