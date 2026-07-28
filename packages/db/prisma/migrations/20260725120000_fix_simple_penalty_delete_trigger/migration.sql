-- DELETE has no NEW row. Only validate parent identity on UPDATE.
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
    IF TG_OP = 'UPDATE' AND NEW."ruleVersionId" IS DISTINCT FROM OLD."ruleVersionId" THEN
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
