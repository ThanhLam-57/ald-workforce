-- Payroll is a financial ledger. Source periods and their calculated rows are
-- never hard-deleted; locked/published periods can only perform LOCKED -> PUBLISHED.
CREATE OR REPLACE FUNCTION protect_payroll_period()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payroll periods cannot be hard-deleted';
  END IF;

  IF OLD.status IN ('LOCKED', 'PUBLISHED') THEN
    IF OLD.status = 'LOCKED'
       AND NEW.status = 'PUBLISHED'
       AND (to_jsonb(NEW) - ARRAY[
         'status', 'version', 'publishedByUserId', 'publishedAt',
         'publishReason', 'updatedAt'
       ]) = (to_jsonb(OLD) - ARRAY[
         'status', 'version', 'publishedByUserId', 'publishedAt',
         'publishReason', 'updatedAt'
       ])
       AND NEW.version = OLD.version + 1
       AND NEW."publishedByUserId" IS NOT NULL
       AND NEW."publishedAt" IS NOT NULL
       AND NEW."publishReason" IS NOT NULL
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Locked or published payroll periods are immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_periods_guard"
BEFORE UPDATE OR DELETE ON "payroll_periods"
FOR EACH ROW EXECUTE FUNCTION protect_payroll_period();

CREATE OR REPLACE FUNCTION protect_payroll_child()
RETURNS trigger AS $$
DECLARE
  period_status "PayrollPeriodStatus";
  period_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payroll ledger rows cannot be hard-deleted';
  END IF;

  period_id := COALESCE(NEW."payrollPeriodId", OLD."payrollPeriodId");
  SELECT status INTO period_status
  FROM "payroll_periods"
  WHERE id = period_id;

  IF period_status IN ('LOCKED', 'PUBLISHED') THEN
    RAISE EXCEPTION 'Locked or published payroll ledger rows are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_entries_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "payroll_entries"
FOR EACH ROW EXECUTE FUNCTION protect_payroll_child();

CREATE TRIGGER "payroll_adjustments_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "payroll_adjustments"
FOR EACH ROW EXECUTE FUNCTION protect_payroll_child();

CREATE OR REPLACE FUNCTION protect_calculation_snapshot()
RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'Calculation snapshots are append-only';
  END IF;
  PERFORM 1
  FROM "payroll_periods"
  WHERE id = NEW."payrollPeriodId"
    AND status NOT IN ('LOCKED', 'PUBLISHED');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot add a snapshot to locked or published payroll';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "calculation_snapshots_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "calculation_snapshots"
FOR EACH ROW EXECUTE FUNCTION protect_calculation_snapshot();

CREATE OR REPLACE FUNCTION protect_payroll_line()
RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'Payroll lines are append-only';
  END IF;
  PERFORM 1
  FROM "payroll_entries" entry
  JOIN "payroll_periods" period ON period.id = entry."payrollPeriodId"
  WHERE entry.id = NEW."payrollEntryId"
    AND period.status NOT IN ('LOCKED', 'PUBLISHED');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot add a line to locked or published payroll';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_lines_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "payroll_lines"
FOR EACH ROW EXECUTE FUNCTION protect_payroll_line();

CREATE OR REPLACE FUNCTION prevent_financial_log_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Financial logs cannot be hard-deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_export_jobs_no_delete"
BEFORE DELETE ON "payroll_export_jobs"
FOR EACH ROW EXECUTE FUNCTION prevent_financial_log_delete();

CREATE TRIGGER "payroll_download_logs_no_delete"
BEFORE DELETE ON "payroll_download_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_financial_log_delete();

ALTER TABLE "payroll_adjustments"
  ADD CONSTRAINT "payroll_adjustments_amount_policy"
  CHECK (
    "type" = 'CORRECTION'
    OR "amount" >= 0
  );
