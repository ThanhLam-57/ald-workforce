ALTER TABLE "users"
ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "invitedAt" TIMESTAMPTZ(3),
ADD COLUMN "passwordChangedAt" TIMESTAMPTZ(3),
ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "two_factors" (
  "id" UUID NOT NULL,
  "secret" TEXT NOT NULL,
  "backupCodes" TEXT NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT true,
  "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMPTZ(3),
  "userId" UUID NOT NULL,
  CONSTRAINT "two_factors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "two_factors_userId_key" ON "two_factors"("userId");
CREATE INDEX "two_factors_secret_idx" ON "two_factors"("secret");
ALTER TABLE "two_factors"
ADD CONSTRAINT "two_factors_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "rate_limits" (
  "id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "lastRequest" BIGINT NOT NULL,
  CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rate_limits_key_key" ON "rate_limits"("key");
CREATE INDEX "rate_limits_lastRequest_idx" ON "rate_limits"("lastRequest");
