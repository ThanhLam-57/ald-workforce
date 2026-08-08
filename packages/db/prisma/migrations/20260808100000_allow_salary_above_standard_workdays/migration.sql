-- The simplified rule center follows the company policy that every recorded work unit is paid.
-- Update only the current SIMPLE_MUTABLE salary rule. Historical payroll snapshots and
-- VERSIONED salary rules keep their original configuration.
UPDATE "rule_versions" AS version
SET
  "configuration" = jsonb_set(
    version."configuration",
    '{attendancePolicy,capAtStandardWorkdays}',
    'false'::jsonb,
    true
  ),
  "rowVersion" = version."rowVersion" + 1,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "rule_sets" AS rule_set
WHERE rule_set.id = version."ruleSetId"
  AND rule_set.type = 'SALARY_RULES'
  AND rule_set."managementMode" = 'SIMPLE_MUTABLE'
  AND version."isSimpleCurrent" = true
  AND version."supersededAt" IS NULL
  AND version."configuration" IS NOT NULL
  AND COALESCE(
    version."configuration" -> 'attendancePolicy' ->> 'capAtStandardWorkdays',
    'true'
  ) <> 'false';
