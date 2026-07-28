-- Store each employee's contractual base salary as integer VND.
ALTER TABLE "staff_members"
ADD COLUMN "baseSalaryAmount" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "staff_members"
ADD CONSTRAINT "staff_members_baseSalaryAmount_nonnegative"
CHECK ("baseSalaryAmount" >= 0);
