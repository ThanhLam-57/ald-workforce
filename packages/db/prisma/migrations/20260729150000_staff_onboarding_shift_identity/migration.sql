CREATE TYPE "StaffIdentityDocumentSide" AS ENUM (
  'CITIZEN_ID_FRONT',
  'CITIZEN_ID_BACK'
);

CREATE TYPE "StaffIdentityDocumentStatus" AS ENUM (
  'PENDING_UPLOAD',
  'READY',
  'REJECTED',
  'SUPERSEDED'
);

CREATE TABLE "staff_work_schedules" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "staffId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "scheduledStartMinutes" INTEGER NOT NULL,
  "scheduledEndMinutes" INTEGER NOT NULL,
  "spansNextDay" BOOLEAN NOT NULL DEFAULT false,
  "requiredLiveMinutes" INTEGER NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "archivedAt" TIMESTAMPTZ(3),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "staff_work_schedules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_work_schedules_interval_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveFrom" < "effectiveTo"),
  CONSTRAINT "staff_work_schedules_start_check"
    CHECK ("scheduledStartMinutes" BETWEEN 0 AND 1439),
  CONSTRAINT "staff_work_schedules_end_check"
    CHECK ("scheduledEndMinutes" BETWEEN 0 AND 1439),
  CONSTRAINT "staff_work_schedules_overnight_check"
    CHECK (
      (NOT "spansNextDay" AND "scheduledEndMinutes" > "scheduledStartMinutes")
      OR
      ("spansNextDay" AND "scheduledEndMinutes" <= "scheduledStartMinutes")
    ),
  CONSTRAINT "staff_work_schedules_live_duration_check"
    CHECK (
      "requiredLiveMinutes" > 0
      AND "requiredLiveMinutes" <= (
        "scheduledEndMinutes" - "scheduledStartMinutes"
        + CASE WHEN "spansNextDay" THEN 1440 ELSE 0 END
      )
    ),
  CONSTRAINT "staff_work_schedules_version_check"
    CHECK ("version" > 0)
);

CREATE INDEX "staff_work_schedules_scope_interval_idx"
  ON "staff_work_schedules"("companyId", "branchId", "effectiveFrom", "effectiveTo");

CREATE INDEX "staff_work_schedules_staff_interval_idx"
  ON "staff_work_schedules"("companyId", "staffId", "effectiveFrom", "effectiveTo");

ALTER TABLE "staff_work_schedules"
  ADD CONSTRAINT "staff_work_schedules_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "staff_work_schedules_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "staff_work_schedules_staffId_fkey"
    FOREIGN KEY ("staffId") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "staff_work_schedules_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "staff_work_schedules_no_overlap"
    EXCLUDE USING gist (
      "companyId" WITH =,
      "staffId" WITH =,
      daterange("effectiveFrom", "effectiveTo", '[)') WITH &&
    ) WHERE ("archivedAt" IS NULL);

CREATE TABLE "staff_identity_documents" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "staffId" UUID NOT NULL,
  "side" "StaffIdentityDocumentSide" NOT NULL,
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
  "rejectionReason" TEXT,
  "supersededAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "staff_identity_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_identity_documents_size_check"
    CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 8388608),
  CONSTRAINT "staff_identity_documents_version_check"
    CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "staff_identity_documents_objectKey_key"
  ON "staff_identity_documents"("objectKey");

CREATE UNIQUE INDEX "staff_identity_documents_one_ready_side_idx"
  ON "staff_identity_documents"("companyId", "staffId", "side")
  WHERE "status" = 'READY';

CREATE INDEX "staff_identity_documents_scope_status_idx"
  ON "staff_identity_documents"("companyId", "branchId", "staffId", "status");

CREATE INDEX "staff_identity_documents_current_side_idx"
  ON "staff_identity_documents"("companyId", "staffId", "side", "supersededAt");

ALTER TABLE "staff_identity_documents"
  ADD CONSTRAINT "staff_identity_documents_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "staff_identity_documents_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "staff_identity_documents_staffId_fkey"
    FOREIGN KEY ("staffId") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "staff_identity_documents_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
