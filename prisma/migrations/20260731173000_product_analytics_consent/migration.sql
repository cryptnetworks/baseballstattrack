-- CreateEnum
CREATE TYPE "ProductAnalyticsConsentStatus" AS ENUM ('OPTED_IN', 'OPTED_OUT');

-- CreateTable
CREATE TABLE "ProductAnalyticsConsent" (
    "appUserId" TEXT NOT NULL,
    "status" "ProductAnalyticsConsentStatus" NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAnalyticsConsent_pkey" PRIMARY KEY ("appUserId")
);

-- CreateIndex
CREATE INDEX "ProductAnalyticsConsent_status_expiresAt_idx" ON "ProductAnalyticsConsent"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "ProductAnalyticsConsent" ADD CONSTRAINT "ProductAnalyticsConsent_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductAnalyticsConsent"
  ADD CONSTRAINT "ProductAnalyticsConsent_policy_check"
  CHECK (length("policyVersion") BETWEEN 1 AND 64),
  ADD CONSTRAINT "ProductAnalyticsConsent_lifecycle_check"
  CHECK (
    ("status" = 'OPTED_IN' AND "grantedAt" IS NOT NULL AND "withdrawnAt" IS NULL AND "expiresAt" > "grantedAt")
    OR ("status" = 'OPTED_OUT' AND "grantedAt" IS NULL AND "withdrawnAt" IS NOT NULL AND "expiresAt" IS NULL)
  );
