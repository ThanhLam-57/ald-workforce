-- Keep employment milestones as business dates without altering existing staff or payroll snapshots.
ALTER TABLE "staff_members"
  ADD COLUMN "joinedDate" DATE,
  ADD COLUMN "officialDate" DATE;

ALTER TABLE "staff_members"
  ADD CONSTRAINT "staff_members_employment_dates_order_check"
  CHECK (
    "officialDate" IS NULL
    OR "joinedDate" IS NULL
    OR "officialDate" >= "joinedDate"
  );
