ALTER TABLE "staff_members"
ADD COLUMN "terminationDate" DATE;

CREATE INDEX "staff_members_companyId_terminationDate_idx"
ON "staff_members"("companyId", "terminationDate");
