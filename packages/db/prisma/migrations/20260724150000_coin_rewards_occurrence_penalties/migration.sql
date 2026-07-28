ALTER TYPE "RevenueUnit" ADD VALUE IF NOT EXISTS 'COIN';

ALTER TABLE "violations"
  ADD COLUMN "penaltyItemCode" TEXT,
  ADD COLUMN "countingKey" TEXT,
  ADD COLUMN "occurrenceNo" INTEGER,
  ADD COLUMN "countingWindow" TEXT,
  ADD COLUMN "countingPeriodStart" DATE,
  ADD COLUMN "countingPeriodEnd" DATE,
  ADD COLUMN "penaltyStartsAt" INTEGER,
  ADD COLUMN "snapshottedDefaultAmount" BIGINT,
  ADD COLUMN "computedAmount" BIGINT,
  ADD COLUMN "isChargeable" BOOLEAN,
  ADD COLUMN "responsibleParty" TEXT;

WITH numbered AS (
  SELECT
    v.id,
    p.code,
    date_trunc('month', v."businessDate")::date AS period_start,
    (date_trunc('month', v."businessDate") + interval '1 month')::date AS period_end,
    row_number() OVER (
      PARTITION BY v."companyId", v."staffId", p.code, date_trunc('month', v."businessDate")
      ORDER BY v."businessDate", v."createdAt", v.id
    )::integer AS occurrence_no
  FROM "violations" v
  JOIN "penalty_items" p ON p.id = v."penaltyItemId"
)
UPDATE "violations" v
SET
  "penaltyItemCode" = numbered.code,
  "countingKey" = numbered.code,
  "occurrenceNo" = numbered.occurrence_no,
  "countingWindow" = 'CALENDAR_MONTH',
  "countingPeriodStart" = numbered.period_start,
  "countingPeriodEnd" = numbered.period_end,
  "penaltyStartsAt" = 1,
  "snapshottedDefaultAmount" = v.amount,
  "computedAmount" = v.amount,
  "isChargeable" = true,
  "responsibleParty" = 'VIOLATING_STAFF'
FROM numbered
WHERE numbered.id = v.id;

ALTER TABLE "violations"
  ALTER COLUMN "penaltyItemCode" SET NOT NULL,
  ALTER COLUMN "countingKey" SET NOT NULL,
  ALTER COLUMN "occurrenceNo" SET NOT NULL,
  ALTER COLUMN "countingWindow" SET NOT NULL,
  ALTER COLUMN "countingPeriodStart" SET NOT NULL,
  ALTER COLUMN "penaltyStartsAt" SET NOT NULL,
  ALTER COLUMN "snapshottedDefaultAmount" SET NOT NULL,
  ALTER COLUMN "computedAmount" SET NOT NULL,
  ALTER COLUMN "isChargeable" SET NOT NULL,
  ALTER COLUMN "responsibleParty" SET NOT NULL;

ALTER TABLE "violations"
  ADD CONSTRAINT "violations_occurrence_positive_check" CHECK ("occurrenceNo" > 0),
  ADD CONSTRAINT "violations_penalty_starts_positive_check" CHECK ("penaltyStartsAt" > 0),
  ADD CONSTRAINT "violations_counting_window_check"
    CHECK ("countingWindow" IN ('CALENDAR_MONTH', 'LIFETIME')),
  ADD CONSTRAINT "violations_responsible_party_check"
    CHECK ("responsibleParty" IN ('VIOLATING_STAFF', 'PRIMARY_MANAGER')),
  ADD CONSTRAINT "violations_amount_snapshots_nonnegative_check"
    CHECK (
      amount >= 0
      AND "snapshottedDefaultAmount" >= 0
      AND "computedAmount" >= 0
    );

CREATE UNIQUE INDEX "violations_occurrence_sequence_key"
  ON "violations"("companyId", "staffId", "countingKey", "countingPeriodStart", "occurrenceNo");

CREATE INDEX "violations_occurrence_lookup_idx"
  ON "violations"("companyId", "staffId", "countingKey", "countingPeriodStart", "occurrenceNo");
