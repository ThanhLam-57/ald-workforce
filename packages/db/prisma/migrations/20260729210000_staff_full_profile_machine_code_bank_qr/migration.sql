ALTER TABLE "staff_members"
  ADD COLUMN "tiktokChannelId" TEXT,
  ADD COLUMN "dateOfBirth" DATE,
  ADD COLUMN "citizenIdNumber" TEXT,
  ADD COLUMN "bankAccountNumber" TEXT,
  ADD COLUMN "bankName" TEXT,
  ADD COLUMN "permanentAddress" TEXT,
  ADD COLUMN "temporaryAddress" TEXT,
  ADD COLUMN "facebookUrl" TEXT,
  ADD COLUMN "university" TEXT;

CREATE UNIQUE INDEX "staff_members_companyId_citizenIdNumber_key"
  ON "staff_members"("companyId", "citizenIdNumber");

ALTER TABLE "branch_assignments"
  ADD COLUMN "attendanceMachineCode" TEXT;

CREATE INDEX "branch_assignments_machine_code_idx"
  ON "branch_assignments"("companyId", "branchId", "attendanceMachineCode");

ALTER TABLE "branch_assignments"
  ADD CONSTRAINT "branch_assignments_machine_code_format_check"
  CHECK (
    "attendanceMachineCode" IS NULL
    OR (
      "assignmentType" = 'MEMBER'
      AND "attendanceMachineCode" ~ '^[A-Z0-9_-]{1,30}$'
    )
  );

ALTER TABLE "branch_assignments"
  ADD CONSTRAINT "branch_assignments_machine_code_no_overlap"
  EXCLUDE USING gist (
    "companyId" WITH =,
    "branchId" WITH =,
    "attendanceMachineCode" WITH =,
    daterange("effectiveFrom", "effectiveTo", '[)') WITH &&
  ) WHERE (
    "attendanceMachineCode" IS NOT NULL
    AND "archivedAt" IS NULL
    AND "assignmentType" = 'MEMBER'
  );

ALTER TABLE "staff_identity_documents"
  ADD COLUMN "rejectedAt" TIMESTAMPTZ(3);

CREATE TABLE "staff_bank_qr_documents" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "staffId" UUID NOT NULL,
  "objectKey" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "status" "StaffIdentityDocumentStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "uploadedAt" TIMESTAMPTZ(3),
  "verifiedAt" TIMESTAMPTZ(3),
  "rejectedAt" TIMESTAMPTZ(3),
  "rejectionReason" TEXT,
  "supersededAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "staff_bank_qr_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_bank_qr_documents_size_check"
    CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 8388608),
  CONSTRAINT "staff_bank_qr_documents_version_check"
    CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "staff_bank_qr_documents_objectKey_key"
  ON "staff_bank_qr_documents"("objectKey");

CREATE UNIQUE INDEX "staff_bank_qr_documents_one_ready_idx"
  ON "staff_bank_qr_documents"("companyId", "staffId")
  WHERE "status" = 'READY';

CREATE INDEX "staff_bank_qr_documents_scope_status_idx"
  ON "staff_bank_qr_documents"("companyId", "branchId", "staffId", "status");

CREATE INDEX "staff_bank_qr_documents_current_idx"
  ON "staff_bank_qr_documents"("companyId", "staffId", "supersededAt");

ALTER TABLE "staff_bank_qr_documents"
  ADD CONSTRAINT "staff_bank_qr_documents_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "staff_bank_qr_documents_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "staff_bank_qr_documents_staffId_fkey"
    FOREIGN KEY ("staffId") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "staff_bank_qr_documents_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
