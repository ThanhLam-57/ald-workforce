CREATE TYPE "ViolationOrigin" AS ENUM ('MANUAL', 'AUTOMATIC');

ALTER TABLE "violations"
  ADD COLUMN "origin" "ViolationOrigin" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "automaticKey" TEXT,
  ADD COLUMN "automaticSnapshot" JSONB;

CREATE UNIQUE INDEX "violations_attendance_automatic_key"
  ON "violations"("companyId", "attendanceId", "automaticKey");

CREATE INDEX "violations_company_origin_status_date_idx"
  ON "violations"("companyId", "origin", status, "businessDate");
