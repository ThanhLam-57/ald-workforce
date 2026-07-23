-- Extend the shared versioned rule engine.
ALTER TYPE "RuleSetType" ADD VALUE 'DAILY_REWARD_TIERS';
ALTER TYPE "RuleSetType" ADD VALUE 'MONTHLY_LEVEL_RULES';
ALTER TYPE "RuleSetType" ADD VALUE 'SALARY_RULES';
ALTER TYPE "RuleSetType" ADD VALUE 'KPI_TEMPLATE';

ALTER TABLE "rule_versions"
ADD COLUMN "configuration" JSONB;

CREATE TYPE "LevelProposalStatus" AS ENUM ('PENDING', 'CONFIRMED', 'OVERRIDDEN');

CREATE TABLE "level_proposals" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "sourceMonth" DATE NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "ruleVersionId" UUID NOT NULL,
    "suggestedPerformanceLevelId" UUID NOT NULL,
    "confirmedPerformanceLevelId" UUID,
    "monthlyRevenue" BIGINT NOT NULL,
    "status" "LevelProposalStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "decisionReason" TEXT,
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "level_proposals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "level_proposals_company_staff_month_key"
ON "level_proposals"("companyId", "staffId", "sourceMonth");

CREATE INDEX "level_proposals_company_month_status_idx"
ON "level_proposals"("companyId", "sourceMonth", "status");

CREATE INDEX "level_proposals_company_effective_status_idx"
ON "level_proposals"("companyId", "effectiveFrom", "status");

ALTER TABLE "level_proposals"
ADD CONSTRAINT "level_proposals_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "level_proposals"
ADD CONSTRAINT "level_proposals_staffId_fkey"
FOREIGN KEY ("staffId") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "level_proposals"
ADD CONSTRAINT "level_proposals_ruleVersionId_fkey"
FOREIGN KEY ("ruleVersionId") REFERENCES "rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "level_proposals"
ADD CONSTRAINT "level_proposals_suggestedPerformanceLevelId_fkey"
FOREIGN KEY ("suggestedPerformanceLevelId") REFERENCES "performance_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "level_proposals"
ADD CONSTRAINT "level_proposals_confirmedPerformanceLevelId_fkey"
FOREIGN KEY ("confirmedPerformanceLevelId") REFERENCES "performance_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "level_proposals"
ADD CONSTRAINT "level_proposals_decidedByUserId_fkey"
FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "level_proposals"
ADD CONSTRAINT "level_proposals_revenue_nonnegative" CHECK ("monthlyRevenue" >= 0),
ADD CONSTRAINT "level_proposals_version_positive" CHECK ("version" > 0),
ADD CONSTRAINT "level_proposals_month_alignment"
CHECK (
  "sourceMonth" = date_trunc('month', "sourceMonth")::date
  AND "effectiveFrom" = ("sourceMonth" + INTERVAL '1 month')::date
),
ADD CONSTRAINT "level_proposals_decision_fields"
CHECK (
  ("status" = 'PENDING'
    AND "confirmedPerformanceLevelId" IS NULL
    AND "decisionReason" IS NULL
    AND "decidedByUserId" IS NULL
    AND "decidedAt" IS NULL)
  OR
  ("status" IN ('CONFIRMED', 'OVERRIDDEN')
    AND "confirmedPerformanceLevelId" IS NOT NULL
    AND "decisionReason" IS NOT NULL
    AND "decidedByUserId" IS NOT NULL
    AND "decidedAt" IS NOT NULL)
);

CREATE OR REPLACE FUNCTION prevent_level_proposal_hard_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Level proposals cannot be hard deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "level_proposals_no_hard_delete"
BEFORE DELETE ON "level_proposals"
FOR EACH ROW EXECUTE FUNCTION prevent_level_proposal_hard_delete();
