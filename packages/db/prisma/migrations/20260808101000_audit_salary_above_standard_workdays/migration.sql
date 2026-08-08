-- Record the one-time SIMPLE_MUTABLE salary policy normalization in the append-only audit log.
-- actorUserId is null because this is a system migration, not an interactive user mutation.
INSERT INTO "audit_logs" (
  id,
  "companyId",
  "branchId",
  "actorUserId",
  action,
  "entityType",
  "entityId",
  reason,
  before,
  after,
  "requestId",
  "ipAddress",
  "userAgent",
  "occurredAt"
)
SELECT
  gen_random_uuid(),
  version."companyId",
  NULL,
  NULL,
  'simple_salary_rules.policy_migrated',
  'RuleVersion',
  version.id::text,
  'SYSTEM:ALLOW_SALARY_ABOVE_STANDARD_WORKDAYS',
  jsonb_build_object(
    'attendancePolicy',
    jsonb_build_object('capAtStandardWorkdays', true),
    'source',
    'LEGACY_SIMPLE_RULE_DEFAULT'
  ),
  version."configuration",
  'MIGRATION:20260808100000_allow_salary_above_standard_workdays',
  NULL,
  'Prisma migration',
  CURRENT_TIMESTAMP
FROM "rule_versions" AS version
JOIN "rule_sets" AS rule_set ON rule_set.id = version."ruleSetId"
WHERE rule_set.type = 'SALARY_RULES'
  AND rule_set."managementMode" = 'SIMPLE_MUTABLE'
  AND version."isSimpleCurrent" = true
  AND version."supersededAt" IS NULL
  AND version."configuration" -> 'attendancePolicy' ->> 'capAtStandardWorkdays' = 'false'
  AND NOT EXISTS (
    SELECT 1
    FROM "audit_logs" AS audit
    WHERE audit."companyId" = version."companyId"
      AND audit."entityType" = 'RuleVersion'
      AND audit."entityId" = version.id::text
      AND audit.action = 'simple_salary_rules.policy_migrated'
      AND audit.reason = 'SYSTEM:ALLOW_SALARY_ABOVE_STANDARD_WORKDAYS'
  );
