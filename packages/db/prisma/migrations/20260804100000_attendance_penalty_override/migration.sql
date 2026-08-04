ALTER TABLE "attendance_days"
ADD COLUMN "penaltyOverrideAmount" BIGINT;

ALTER TABLE "attendance_days"
ADD CONSTRAINT "attendance_days_penalty_override_nonnegative_check"
CHECK ("penaltyOverrideAmount" IS NULL OR "penaltyOverrideAmount" >= 0);
