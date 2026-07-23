-- CreateEnum
CREATE TYPE "RuleSetType" AS ENUM ('PENALTY');

-- CreateEnum
CREATE TYPE "RuleVersionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "ViolationStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('PENDING_UPLOAD', 'READY', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "rule_sets" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "type" "RuleSetType" NOT NULL DEFAULT 'PENALTY',
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_versions" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "ruleSetId" UUID NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" "RuleVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "notes" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "clonedFromVersionId" UUID,
    "createdByUserId" UUID NOT NULL,
    "publishedByUserId" UUID,
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "penalty_items" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "ruleVersionId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "defaultAmount" BIGINT NOT NULL,
    "reminderPolicy" JSONB,
    "metadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayColor" TEXT NOT NULL DEFAULT '#64748B',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "penalty_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "violations" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "attendanceId" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "businessDate" DATE NOT NULL,
    "penaltyItemId" UUID NOT NULL,
    "ruleVersionId" UUID NOT NULL,
    "itemName" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "detail" TEXT NOT NULL,
    "note" TEXT,
    "overrideReason" TEXT,
    "status" "ViolationStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" UUID NOT NULL,
    "cancelledByUserId" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "violations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_objects" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "violationId" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "status" "EvidenceStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" UUID NOT NULL,
    "uploadedAt" TIMESTAMPTZ(3),
    "verifiedAt" TIMESTAMPTZ(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "evidence_objects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rule_sets_company_type_name_key"
ON "rule_sets"("companyId", "type", "name");

CREATE INDEX "rule_sets_company_type_idx"
ON "rule_sets"("companyId", "type");

CREATE UNIQUE INDEX "rule_versions_set_version_key"
ON "rule_versions"("ruleSetId", "versionNo");

CREATE INDEX "rule_versions_company_status_interval_idx"
ON "rule_versions"("companyId", "status", "effectiveFrom", "effectiveTo");

CREATE UNIQUE INDEX "penalty_items_version_code_key"
ON "penalty_items"("ruleVersionId", "code");

CREATE INDEX "penalty_items_company_version_active_order_idx"
ON "penalty_items"("companyId", "ruleVersionId", "isActive", "displayOrder");

CREATE INDEX "violations_company_branch_date_status_idx"
ON "violations"("companyId", "branchId", "businessDate", "status");

CREATE INDEX "violations_company_staff_date_status_idx"
ON "violations"("companyId", "staffId", "businessDate", "status");

CREATE INDEX "violations_attendance_status_idx"
ON "violations"("attendanceId", "status");

CREATE UNIQUE INDEX "evidence_objects_objectKey_key"
ON "evidence_objects"("objectKey");

CREATE INDEX "evidence_objects_scope_violation_status_idx"
ON "evidence_objects"("companyId", "branchId", "violationId", "status");

-- AddForeignKey
ALTER TABLE "rule_sets"
ADD CONSTRAINT "rule_sets_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rule_sets"
ADD CONSTRAINT "rule_sets_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rule_versions"
ADD CONSTRAINT "rule_versions_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rule_versions"
ADD CONSTRAINT "rule_versions_ruleSetId_fkey"
FOREIGN KEY ("ruleSetId") REFERENCES "rule_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rule_versions"
ADD CONSTRAINT "rule_versions_clonedFromVersionId_fkey"
FOREIGN KEY ("clonedFromVersionId") REFERENCES "rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rule_versions"
ADD CONSTRAINT "rule_versions_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rule_versions"
ADD CONSTRAINT "rule_versions_publishedByUserId_fkey"
FOREIGN KEY ("publishedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "penalty_items"
ADD CONSTRAINT "penalty_items_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "penalty_items"
ADD CONSTRAINT "penalty_items_ruleVersionId_fkey"
FOREIGN KEY ("ruleVersionId") REFERENCES "rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "violations"
ADD CONSTRAINT "violations_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "violations"
ADD CONSTRAINT "violations_branchId_fkey"
FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "violations"
ADD CONSTRAINT "violations_attendanceId_fkey"
FOREIGN KEY ("attendanceId") REFERENCES "attendance_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "violations"
ADD CONSTRAINT "violations_staffId_fkey"
FOREIGN KEY ("staffId") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "violations"
ADD CONSTRAINT "violations_penaltyItemId_fkey"
FOREIGN KEY ("penaltyItemId") REFERENCES "penalty_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "violations"
ADD CONSTRAINT "violations_ruleVersionId_fkey"
FOREIGN KEY ("ruleVersionId") REFERENCES "rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "violations"
ADD CONSTRAINT "violations_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "violations"
ADD CONSTRAINT "violations_cancelledByUserId_fkey"
FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "evidence_objects"
ADD CONSTRAINT "evidence_objects_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "evidence_objects"
ADD CONSTRAINT "evidence_objects_branchId_fkey"
FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "evidence_objects"
ADD CONSTRAINT "evidence_objects_violationId_fkey"
FOREIGN KEY ("violationId") REFERENCES "violations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "evidence_objects"
ADD CONSTRAINT "evidence_objects_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Check constraints
ALTER TABLE "rule_sets"
ADD CONSTRAINT "rule_sets_version_positive" CHECK ("version" > 0);

ALTER TABLE "rule_versions"
ADD CONSTRAINT "rule_versions_numbers_positive"
CHECK ("versionNo" > 0 AND "rowVersion" > 0),
ADD CONSTRAINT "rule_versions_valid_interval"
CHECK ("effectiveTo" IS NULL OR ("effectiveFrom" IS NOT NULL AND "effectiveFrom" < "effectiveTo")),
ADD CONSTRAINT "rule_versions_published_dates"
CHECK ("status" = 'DRAFT' OR ("effectiveFrom" IS NOT NULL AND "publishedAt" IS NOT NULL AND "publishedByUserId" IS NOT NULL));

ALTER TABLE "penalty_items"
ADD CONSTRAINT "penalty_items_amount_nonnegative" CHECK ("defaultAmount" >= 0),
ADD CONSTRAINT "penalty_items_order_nonnegative" CHECK ("displayOrder" >= 0),
ADD CONSTRAINT "penalty_items_color_hex" CHECK ("displayColor" ~ '^#[0-9A-Fa-f]{6}$');

ALTER TABLE "violations"
ADD CONSTRAINT "violations_amount_nonnegative" CHECK ("amount" >= 0),
ADD CONSTRAINT "violations_version_positive" CHECK ("version" > 0),
ADD CONSTRAINT "violations_cancel_fields"
CHECK (
  ("status" = 'ACTIVE' AND "cancelledAt" IS NULL AND "cancelledByUserId" IS NULL AND "cancellationReason" IS NULL)
  OR
  ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelledByUserId" IS NOT NULL AND "cancellationReason" IS NOT NULL)
);

ALTER TABLE "evidence_objects"
ADD CONSTRAINT "evidence_objects_size_bounds" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 10485760),
ADD CONSTRAINT "evidence_objects_version_positive" CHECK ("version" > 0),
ADD CONSTRAINT "evidence_objects_mime_allowlist"
CHECK ("mimeType" IN ('image/jpeg', 'image/png', 'image/webp'));

-- Published intervals are half-open [effectiveFrom, effectiveTo) and may not overlap.
ALTER TABLE "rule_versions"
ADD CONSTRAINT "rule_versions_no_published_overlap"
EXCLUDE USING gist (
  "companyId" WITH =,
  "ruleSetId" WITH =,
  daterange("effectiveFrom", "effectiveTo", '[)') WITH &&
)
WHERE ("status" <> 'DRAFT');

-- Published rule content is immutable. Only lifecycle transitions may change
-- status/effectiveTo while all business content remains identical.
CREATE OR REPLACE FUNCTION protect_published_rule_version()
RETURNS trigger AS $$
DECLARE
  old_content JSONB;
  new_content JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Published rule versions are immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" <> 'DRAFT' THEN
    old_content := to_jsonb(OLD) - ARRAY['status', 'effectiveTo', 'rowVersion', 'updatedAt'];
    new_content := to_jsonb(NEW) - ARRAY['status', 'effectiveTo', 'rowVersion', 'updatedAt'];

    IF old_content IS DISTINCT FROM new_content THEN
      RAISE EXCEPTION 'Published rule versions are immutable';
    END IF;

    IF NOT (
      (OLD."status" = 'SCHEDULED' AND NEW."status" = 'ACTIVE' AND NEW."effectiveTo" IS NOT DISTINCT FROM OLD."effectiveTo")
      OR
      (OLD."status" IN ('SCHEDULED', 'ACTIVE') AND NEW."status" = 'RETIRED'
        AND NEW."effectiveTo" IS NOT NULL
        AND NEW."effectiveTo" > OLD."effectiveFrom"
        AND (OLD."effectiveTo" IS NULL OR NEW."effectiveTo" <= OLD."effectiveTo"))
    ) THEN
      RAISE EXCEPTION 'Invalid published rule lifecycle transition';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "rule_versions_published_immutable"
BEFORE UPDATE OR DELETE ON "rule_versions"
FOR EACH ROW EXECUTE FUNCTION protect_published_rule_version();

CREATE OR REPLACE FUNCTION protect_published_penalty_item()
RETURNS trigger AS $$
DECLARE
  target_version UUID;
  target_status "RuleVersionStatus";
BEGIN
  target_version := CASE WHEN TG_OP = 'DELETE' THEN OLD."ruleVersionId" ELSE NEW."ruleVersionId" END;
  SELECT "status" INTO target_status FROM "rule_versions" WHERE "id" = target_version;

  IF target_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Penalty items of published rules are immutable';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "penalty_items_published_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "penalty_items"
FOR EACH ROW EXECUTE FUNCTION protect_published_penalty_item();

CREATE OR REPLACE FUNCTION prevent_violation_hard_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Violations cannot be hard deleted; cancel them instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "violations_no_hard_delete"
BEFORE DELETE ON "violations"
FOR EACH ROW EXECUTE FUNCTION prevent_violation_hard_delete();
