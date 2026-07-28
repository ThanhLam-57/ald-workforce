-- The simplified /rules screen owns one mutable rule set per company/type.
-- Advanced rule centers remain VERSIONED and retain their immutable history.
CREATE TYPE "RuleManagementMode" AS ENUM ('VERSIONED', 'SIMPLE_MUTABLE');

ALTER TABLE "rule_sets"
  ADD COLUMN "managementMode" "RuleManagementMode" NOT NULL DEFAULT 'VERSIONED';

ALTER TABLE "rule_versions"
  ADD COLUMN "supersededAt" TIMESTAMPTZ(3),
  ADD COLUMN "isSimpleCurrent" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "penalty_items"
  ADD COLUMN "archivedAt" TIMESTAMPTZ(3);

-- Recreated at the end of this transactional migration with SIMPLE_MUTABLE-aware logic.
DROP TRIGGER "rule_versions_published_immutable" ON "rule_versions";

-- Drop first so extending the chosen current interval cannot conflict with a
-- legacy version that is being superseded in the same data migration.
ALTER TABLE "rule_versions"
  DROP CONSTRAINT "rule_versions_no_published_overlap";

-- Adopt rule sets that were previously written by the simple-rule service.
-- Audit action is the stable technical marker; display names are deliberately ignored.
WITH audited_versions AS (
  SELECT
    rv.id AS version_id,
    rv."ruleSetId" AS rule_set_id,
    rv."companyId" AS company_id,
    rs.type,
    rv."effectiveTo",
    rv."effectiveFrom",
    rv."versionNo",
    rv."updatedAt"
  FROM "rule_versions" rv
  JOIN "rule_sets" rs ON rs.id = rv."ruleSetId"
  WHERE EXISTS (
    SELECT 1
    FROM "audit_logs" audit
    WHERE audit."companyId" = rv."companyId"
      AND audit."entityId" = rv.id::text
      AND (
        (rs.type = 'DAILY_REWARD_TIERS' AND audit.action = 'simple_reward_rules.apply')
        OR
        (rs.type = 'PENALTY' AND audit.action = 'simple_penalty_rules.apply')
      )
  )
),
chosen_rule_sets AS (
  SELECT DISTINCT ON (company_id, type)
    company_id,
    type,
    rule_set_id
  FROM audited_versions
  ORDER BY
    company_id,
    type,
    ("effectiveTo" IS NULL) DESC,
    "effectiveFrom" DESC NULLS LAST,
    "versionNo" DESC,
    "updatedAt" DESC,
    rule_set_id
),
chosen_versions AS (
  SELECT DISTINCT ON (candidate.rule_set_id)
    candidate.rule_set_id,
    candidate.version_id
  FROM audited_versions candidate
  JOIN chosen_rule_sets chosen ON chosen.rule_set_id = candidate.rule_set_id
  ORDER BY
    candidate.rule_set_id,
    (candidate."effectiveTo" IS NULL) DESC,
    candidate."effectiveFrom" DESC NULLS LAST,
    candidate."versionNo" DESC,
    candidate."updatedAt" DESC,
    candidate.version_id
)
UPDATE "rule_sets" rule_set
SET "managementMode" = 'SIMPLE_MUTABLE'
FROM chosen_rule_sets chosen
WHERE rule_set.id = chosen.rule_set_id;

WITH chosen_versions AS (
  SELECT DISTINCT ON (rv."ruleSetId")
    rv."ruleSetId" AS rule_set_id,
    rv.id AS version_id
  FROM "rule_versions" rv
  JOIN "rule_sets" rs ON rs.id = rv."ruleSetId"
  WHERE rs."managementMode" = 'SIMPLE_MUTABLE'
  ORDER BY
    rv."ruleSetId",
    (rv."effectiveTo" IS NULL) DESC,
    rv."effectiveFrom" DESC NULLS LAST,
    rv."versionNo" DESC,
    rv."updatedAt" DESC,
    rv.id
)
UPDATE "rule_versions" version
SET
  "isSimpleCurrent" = version.id = chosen.version_id,
  "supersededAt" = CASE
    WHEN version.id = chosen.version_id THEN NULL
    ELSE COALESCE(version."supersededAt", CURRENT_TIMESTAMP)
  END,
  "effectiveTo" = CASE
    WHEN version.id = chosen.version_id THEN NULL
    ELSE version."effectiveTo"
  END
FROM chosen_versions chosen
WHERE version."ruleSetId" = chosen.rule_set_id;

CREATE UNIQUE INDEX "rule_sets_company_type_simple_mutable_key"
  ON "rule_sets"("companyId", type)
  WHERE "managementMode" = 'SIMPLE_MUTABLE';

CREATE UNIQUE INDEX "rule_versions_simple_current_key"
  ON "rule_versions"("ruleSetId")
  WHERE "isSimpleCurrent";

CREATE INDEX "rule_sets_company_mode_type_idx"
  ON "rule_sets"("companyId", "managementMode", type);

CREATE INDEX "rule_versions_company_simple_current_idx"
  ON "rule_versions"("companyId", "isSimpleCurrent", status, "effectiveFrom");

CREATE INDEX "penalty_items_company_version_archive_active_idx"
  ON "penalty_items"("companyId", "ruleVersionId", "archivedAt", "isActive", "displayOrder");

ALTER TABLE "rule_versions"
  ADD CONSTRAINT "rule_versions_simple_current_not_superseded"
  CHECK (NOT "isSimpleCurrent" OR "supersededAt" IS NULL);

-- Superseded simple versions must not participate in interval overlap checks.
-- VERSIONED services never set supersededAt, so their overlap protection is unchanged.
ALTER TABLE "rule_versions"
  ADD CONSTRAINT "rule_versions_no_published_overlap"
  EXCLUDE USING gist (
    "companyId" WITH =,
    "ruleSetId" WITH =,
    daterange("effectiveFrom", "effectiveTo", '[)') WITH &&
  )
  WHERE ("status" <> 'DRAFT' AND "supersededAt" IS NULL);

CREATE OR REPLACE FUNCTION protect_published_rule_version()
RETURNS trigger AS $$
DECLARE
  old_content JSONB;
  new_content JSONB;
  target_mode "RuleManagementMode";
BEGIN
  SELECT "managementMode"
  INTO target_mode
  FROM "rule_sets"
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD."ruleSetId" ELSE NEW."ruleSetId" END;

  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Published rule versions are immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF target_mode = 'SIMPLE_MUTABLE' THEN
    IF NEW."ruleSetId" IS DISTINCT FROM OLD."ruleSetId"
      OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
      OR NEW."versionNo" IS DISTINCT FROM OLD."versionNo"
      OR NEW."isSimpleCurrent" IS DISTINCT FROM OLD."isSimpleCurrent"
      OR NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt"
    THEN
      RAISE EXCEPTION 'Simple mutable rule identity cannot change';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" <> 'DRAFT' THEN
    old_content := to_jsonb(OLD) - ARRAY['status', 'effectiveTo', 'rowVersion', 'updatedAt'];
    new_content := to_jsonb(NEW) - ARRAY['status', 'effectiveTo', 'rowVersion', 'updatedAt'];

    IF old_content IS DISTINCT FROM new_content THEN
      RAISE EXCEPTION 'Published rule versions are immutable';
    END IF;

    IF NOT (
      (OLD."status" = 'SCHEDULED' AND NEW."status" = 'ACTIVE'
        AND NEW."effectiveTo" IS NOT DISTINCT FROM OLD."effectiveTo")
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
  target_mode "RuleManagementMode";
BEGIN
  target_version := CASE WHEN TG_OP = 'DELETE' THEN OLD."ruleVersionId" ELSE NEW."ruleVersionId" END;
  SELECT rv.status, rs."managementMode"
  INTO target_status, target_mode
  FROM "rule_versions" rv
  JOIN "rule_sets" rs ON rs.id = rv."ruleSetId"
  WHERE rv.id = target_version;

  IF target_mode = 'SIMPLE_MUTABLE' THEN
    IF TG_OP <> 'INSERT' AND NEW."ruleVersionId" IS DISTINCT FROM OLD."ruleVersionId" THEN
      RAISE EXCEPTION 'Simple mutable penalty item identity cannot change';
    END IF;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF target_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Penalty items of published rules are immutable';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
